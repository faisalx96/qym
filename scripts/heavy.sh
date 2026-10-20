#!/usr/bin/env bash
# Run a memory-heavy dev command (full Vitest, Playwright, builds, pytest -n) under a
# machine-wide budget so several runs, agents or terminals cannot push the host into
# swap thrash and get the whole session killed by the OOM killer / systemd-oomd.
#
#   scripts/heavy.sh [--cost GB] [--min-cost GB] [--name LABEL] [--timeout SEC] -- <command...>
#
# What it does, in order:
#   1. Budget: reserve = max(2 GB, 20% of RAM) stays free for the desktop and the
#      orchestrating process; cost (default 3 GB) is what this command may use.
#   2. Admission: waits until MemAvailable - cost >= reserve and (Linux) memory
#      pressure (/proc/pressure/memory, some avg10) is below 20%.
#   3. Slot: takes one of N slots, N = clamp(floor((RAM - reserve) / cost), 1, 4),
#      shared by every user of this script on the machine (lock dir in
#      $XDG_RUNTIME_DIR or /tmp), so concurrency follows the machine, not a constant.
#   4. Caps: exports VITEST_MAX_WORKERS and QYM_PW_WORKERS sized from the budget;
#      vitest.config.ts and playwright.config.ts honour them. Do not pass --workers.
#   5. Isolation (Linux with systemd + cgroup v2): runs the command in a transient
#      scope with MemoryHigh=cost (throttle) and MemoryMax=cost+1G, and its own
#      oomd pressure policy, so when memory runs short the kernel/oomd kills the
#      test run, never the terminal or the agent that launched it. Elsewhere the
#      command runs directly, still gated by 1-4.
#
#   6. Swap: when less than 1 GB of swap is free the reserve grows by 1 GB. The reclaim that
#      trips systemd-oomd comes from a nearly full swap, not from MemAvailable (2026-10-19:
#      a folder run admitted at 2 GB with 0.6 GB of swap free thrashed, the slice crossed the
#      pressure limit and oomd killed the terminal scope holding the orchestrator).
#   7. Adaptation (opt-in): with --min-cost GB (or QYM_HEAVY_MIN_COST_GB) below --cost, a command
#      not admitted within QYM_HEAVY_ADAPT_AFTER seconds (default 300) while pressure is low has
#      its cost lowered by 1 GB at a time, never below --min-cost, and the script says so. By
#      default the floor equals the cost: a run is never admitted under a cap smaller than the
#      cost its command needs (a capped cgroup that thrashes is what killed the session above).
#      A --cost the host cannot admit waits and logs `waiting`; that log line is the signal.
#
# Cost guide (GB): 2 = Vitest subset, tsc, builds, one Playwright spec file; 3 = npm run check,
# one Playwright folder, pytest tests/sdk; 4 = full Playwright, pytest tests/platform in chunks
# of ~48 files (a whole-suite `pytest -n 2 tests/platform` at 3 GB is killed by its own cap).
# cost + reserve must fit under what the desktop leaves free; on a 15 GB host with VS Code
# and a browser open that is about 7 GB, so --cost 5 never admits.
#
# Environment overrides: QYM_HEAVY_RESERVE_GB, QYM_HEAVY_COST_GB, QYM_HEAVY_MAX_SLOTS,
# QYM_HEAVY_NO_SCOPE=1 (skip systemd-run), QYM_HEAVY_LOCK_DIR, QYM_HEAVY_MIN_COST_GB (adaptation
# floor; default = the cost, i.e. no adaptation), QYM_HEAVY_ADAPT_AFTER (seconds), QYM_HEAVY_SWAP_FLOOR_MB
# (default 1024: below this much free swap the reserve grows by 1 GB).
set -euo pipefail

cost_gb="${QYM_HEAVY_COST_GB:-3}"
min_cost_gb="${QYM_HEAVY_MIN_COST_GB:-}"
name="heavy"
timeout_s=7200
while [ $# -gt 0 ]; do
    case "$1" in
        --cost) cost_gb="$2"; shift 2 ;;
        --min-cost) min_cost_gb="$2"; shift 2 ;;
        --name) name="$2"; shift 2 ;;
        --timeout) timeout_s="$2"; shift 2 ;;
        --) shift; break ;;
        -h|--help) sed -n 2,36p "$0"; exit 0 ;;
        *) break ;;
    esac
done
[ $# -gt 0 ] || { echo "heavy.sh: no command given" >&2; exit 2; }

# --- memory probes (kB) --------------------------------------------------------
mem_total_kb() {
    if [ -r /proc/meminfo ]; then awk '/^MemTotal:/{print $2}' /proc/meminfo
    else echo $(( $(sysctl -n hw.memsize 2>/dev/null || echo 8589934592) / 1024 )); fi
}
mem_avail_kb() {
    if [ -r /proc/meminfo ]; then awk '/^MemAvailable:/{print $2}' /proc/meminfo
    else # macOS: free + inactive + speculative pages
        vm_stat 2>/dev/null | awk -v ps="$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)" '
            /Pages free|Pages inactive|Pages speculative/ {gsub("\\.","",$NF); s+=$NF}
            END {print int(s*ps/1024)}'
    fi
}
swap_free_kb() { # Linux only; elsewhere "no swap" (a large number)
    if [ -r /proc/meminfo ]; then
        awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{ if (t+0 == 0) print 1073741824; else print f }' /proc/meminfo
    else echo 1073741824; fi
}
swap_floor_kb=$(( ${QYM_HEAVY_SWAP_FLOOR_MB:-1024} * 1024 ))
mem_pressure() { # Linux PSI "some avg10", else 0
    if [ -r /proc/pressure/memory ]; then awk 'NR==1{sub("avg10=","",$2); print $2}' /proc/pressure/memory
    else echo 0; fi
}

total_kb=$(mem_total_kb)
total_gb=$(( total_kb / 1048576 ))
reserve_gb="${QYM_HEAVY_RESERVE_GB:-}"
if [ -z "$reserve_gb" ]; then
    reserve_gb=$(( total_gb / 5 )); [ "$reserve_gb" -lt 2 ] && reserve_gb=2
fi
[ -z "$min_cost_gb" ] && min_cost_gb="$cost_gb"
[ "$min_cost_gb" -lt 2 ] && min_cost_gb=2
[ "$min_cost_gb" -gt "$cost_gb" ] && min_cost_gb="$cost_gb"
cost_kb=$(( cost_gb * 1048576 ))
base_reserve_gb="$reserve_gb"
reserve_kb=$(( reserve_gb * 1048576 ))
slots=$(( (total_gb - reserve_gb) / cost_gb ))
[ "$slots" -lt 1 ] && slots=1
max_slots="${QYM_HEAVY_MAX_SLOTS:-4}"
[ "$slots" -gt "$max_slots" ] && slots="$max_slots"

lock_dir="${QYM_HEAVY_LOCK_DIR:-${XDG_RUNTIME_DIR:-/tmp}/qym-heavy-$(id -u)}"
mkdir -p "$lock_dir"

# --- admission + slot ------------------------------------------------------------
deadline=$(( $(date +%s) + timeout_s ))
adapt_every="${QYM_HEAVY_ADAPT_AFTER:-300}"   # seconds of waiting before the cost drops by 1 GB
adapt_after="$adapt_every"
slot=""
waited=0
while :; do
    avail_kb=$(mem_avail_kb)
    pressure=$(mem_pressure)
    # Swap-aware reserve: a nearly full swap means the kernel is already reclaiming; one more
    # GB of headroom keeps the user slice under the oomd pressure limit.
    swap_kb=$(swap_free_kb)
    if [ "$swap_kb" -lt "$swap_floor_kb" ]; then reserve_gb=$(( base_reserve_gb + 1 )); swap_note=", swap free $((swap_kb/1024)) MB: reserve +1G"
    else reserve_gb="$base_reserve_gb"; swap_note=""; fi
    reserve_kb=$(( reserve_gb * 1048576 ))
    ok_mem=$(( avail_kb - cost_kb >= reserve_kb ))
    ok_psi=$(awk -v p="$pressure" 'BEGIN{print (p+0 < 20) ? 1 : 0}')
    if [ "$ok_mem" = 1 ] && [ "$ok_psi" = 1 ]; then
        for i in $(seq 1 "$slots"); do
            exec {fd}>"$lock_dir/slot-$i.lock"
            if flock -n "$fd"; then slot="$i"; echo "$name $$ $(date +%FT%T)" >&"$fd"; break; fi
            exec {fd}>&-
        done
        [ -n "$slot" ] && break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "heavy.sh [$name]: gave up after ${timeout_s}s (avail $((avail_kb/1024)) MB, psi $pressure, slots $slots busy)" >&2
        exit 75
    fi
    if [ $(( waited % 60 )) = 0 ]; then
        echo "heavy.sh [$name]: waiting (avail $((avail_kb/1024)) MB, need $(( (cost_kb+reserve_kb)/1024 )) MB${swap_note}, psi $pressure%, slots $slots)" >&2
    fi
    # Adapt (opt-in, --min-cost): after adapt_after seconds lower the cost by 1 GB, never below
    # the floor the caller declared its command can live with. Never below the default floor
    # (= the cost): a run admitted under a cap it needs more than thrashes and gets the whole
    # terminal scope killed (2026-10-19).
    if [ "$waited" -ge "$adapt_after" ] && [ "$ok_psi" = 1 ] && [ "$cost_gb" -gt "$min_cost_gb" ]; then
        cost_gb=$(( cost_gb - 1 )); cost_kb=$(( cost_gb * 1048576 ))
        slots=$(( (total_gb - reserve_gb) / cost_gb )); [ "$slots" -lt 1 ] && slots=1; [ "$slots" -gt "$max_slots" ] && slots="$max_slots"
        echo "heavy.sh [$name]: not admitted after ${waited}s, lowering cost to ${cost_gb}G (floor --min-cost ${min_cost_gb}G)" >&2
        adapt_after=$(( waited + adapt_every ))
    fi
    sleep 10; waited=$(( waited + 10 ))
done

# --- worker caps from the budget ---------------------------------------------------
free_gb=$(( (avail_kb - reserve_kb) / 1048576 ))
[ "$free_gb" -lt "$cost_gb" ] || free_gb="$cost_gb"
vw=$(( free_gb * 10 / 6 )); [ "$vw" -lt 1 ] && vw=1; [ "$vw" -gt 4 ] && vw=4
pw=$(( free_gb * 10 / 15 )); [ "$pw" -lt 1 ] && pw=1; [ "$pw" -gt 2 ] && pw=2
export VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-$vw}"
export QYM_PW_WORKERS="${QYM_PW_WORKERS:-$pw}"
echo "heavy.sh [$name]: slot $slot/$slots, budget ${cost_gb}G (reserve ${reserve_gb}G of ${total_gb}G), vitest workers $VITEST_MAX_WORKERS, playwright workers $QYM_PW_WORKERS" >&2

# --- run, isolated in a transient cgroup when possible -----------------------------
use_scope=0
if [ "${QYM_HEAVY_NO_SCOPE:-0}" != 1 ] && command -v systemd-run >/dev/null 2>&1 \
   && [ -d /sys/fs/cgroup ] && [ -f /sys/fs/cgroup/cgroup.controllers ] \
   && systemd-run --user --scope --quiet -- true 2>/dev/null; then
    use_scope=1
fi
if [ "$use_scope" = 1 ]; then
    exec systemd-run --user --scope --quiet --collect --unit="qym-$name-$$" \
        -p "MemoryHigh=${cost_gb}G" -p "MemoryMax=$(( cost_gb + 1 ))G" \
        -p ManagedOOMMemoryPressure=kill -p ManagedOOMMemoryPressureLimit=60% \
        -- "$@" {fd}>&-
else
    exec "$@" {fd}>&-
fi
