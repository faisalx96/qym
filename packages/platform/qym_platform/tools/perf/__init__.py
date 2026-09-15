"""Performance-lab tooling: synthetic prod-shaped data, DB statistics, benchmarks.

These modules are shipped inside the platform image so the same code can seed a
local Postgres, report table sizes from inside a deployed pod, and drive load
against a running instance. See ``docs/internal/PERF_LAB.md``.
"""
