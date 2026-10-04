/* Exercise the shipped controller with deliberately reordered network replies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(process.argv[2], 'packages/platform/qym_platform/_static/dashboard/run_details.js'), 'utf8');

function harness() {
  const calls = [];
  let active = 0;
  let maximum = 0;
  const context = { window: {}, AbortController, fetch(url, options) {
    active++;
    maximum = Math.max(maximum, active);
    return new Promise((resolve, reject) => {
      const call = { url, body: JSON.parse(options.body), options, settled: false };
      const finish = callback => {
        if (call.settled) return;
        call.settled = true;
        active--;
        callback();
      };
      call.reply = (data, status = 200) => finish(() => resolve({ ok: status === 200, status, json: async () => data }));
      call.fail = () => finish(() => reject(new Error('network failed')));
      const onAbort = () => finish(() => reject(new Error('aborted')));
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
      calls.push(call);
    });
  } };
  vm.runInNewContext(source, context);
  return { calls, maximum: () => maximum, create(options = {}) {
    return context.window.QymRunDetails.create({ runId: 'run/1', apiUrl: value => '/' + value, ...options });
  } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
// Shapes follow services/run_payloads.py: the index drops explanations and
// large judge values, keeps error flags and short scalars, and replaces
// attempt output with a digest.
const compact = id => ({ item_id: String(id), compare_item_id: 'aligned-' + id, alignment_source: 'dataset',
  metric_values: [id], metric_meta: { accuracy: { modified: false } },
  input_preview: 'question ' + id, output_digest: 'digest-' + id, __has_output: true, __execution_error: '',
  pass_metric_meta: { accuracy: [{ label: 'keep', status: 'error', error: 'E'.repeat(300) }] },
  pass_attempts: [{ pass_number: 1, status: 'completed', __has_output: true, __execution_error: '', output_digest: 'attempt-digest-' + id }],
  __details_loaded: false });
const full = id => ({ item_id: String(id), compare_item_id: 'wrong-' + id, alignment_source: 'wrong',
  input: 'question ' + id, output_full: 'answer ' + id, metric_values: [id],
  metric_meta: { accuracy: { explanation: 'judge ' + id, modified: true, llm_result: 'x'.repeat(5000), gold: [1, 2] } },
  pass_metric_meta: { accuracy: [{ explanation: 'pass judge ' + id, label: 'keep', status: 'error', error: 'E'.repeat(300), llm_result: 'y'.repeat(900) }] },
  pass_attempts: [{ output: 'attempt ' + id, pass_number: 1, status: 'completed' }] });
const replyRows = call => call.reply({ rows: call.body.item_ids.map(full) });
// Pass loaders search with pass_numbers and read their pass's matches.
const replyMatches = (call, byIndex) => call.reply(call.body.pass_numbers
  ? { matches_by_pass: Object.fromEntries(call.body.pass_numbers.map(pass => [pass, byIndex])) }
  : { matches: byIndex });

async function deduplicationAndEviction() {
  const h = harness();
  const controller = h.create({ maxLoaded: 2 });
  const rows = Array.from({ length: 5 }, (_, i) => compact(i));
  const first = controller.ensureRows(rows.slice(0, 2));
  const overlapping = controller.ensureRows(rows.slice(1, 3));
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[0].body.item_ids, ['0', '1']);
  assert.deepEqual(h.calls[1].body.item_ids, ['2']);
  assert.match(h.calls[0].url, /run%2F1\/items\/details$/);
  replyRows(h.calls[1]);
  replyRows(h.calls[0]);
  await Promise.all([first, overlapping]);
  assert.equal(rows[0].compare_item_id, 'aligned-0');
  assert.equal(rows[0].alignment_source, 'dataset');
  assert.equal(rows[1].metric_meta.accuracy.llm_result.length, 5000);
  assert.equal(rows[1].output_digest, 'digest-1');
  controller.releaseExcept([rows[1]]);
  assert.equal(rows[0].__details_loaded, false);
  assert.equal(rows[0].output_full, undefined);
  assert.equal(rows[0].input_preview, 'question 0');
  assert.equal(rows[0].output_digest, 'digest-0');
  // Release rebuilds the index form from current values: edits survive and
  // large judge values go.
  assert.equal(JSON.stringify(rows[0].metric_meta), JSON.stringify({ accuracy: { modified: true } }));
  assert.equal(JSON.stringify(rows[0].pass_metric_meta.accuracy[0]), JSON.stringify({ label: 'keep', status: 'error', error: 'E'.repeat(300) }));
  assert.equal(rows[0].pass_attempts[0].output, undefined);
  assert.equal(rows[0].pass_attempts[0].output_digest, 'attempt-digest-0');
  assert.equal(rows[0].pass_attempts[0].__has_output, true);
  assert.equal(rows[0].pass_attempts[0].status, 'completed');
  const reload = controller.ensureRows([rows[0]]);
  replyRows(h.calls.at(-1));
  await reload;
  assert.equal(rows[0].output_full, 'answer 0');
  assert.equal(controller.ensureRows([rows[0]]), null);
  const edited = { ...rows[0], metric_values: [99] };
  controller.adoptRow(edited, rows[0]);
  controller.releaseExcept([]);
  assert.deepEqual(edited.metric_values, [99]);
  assert.equal(edited.output_full, undefined);
  controller.stop();
}

async function batchingAndRetention() {
  const h = harness();
  const controller = h.create({ maxLoaded: 20 });
  const rows = Array.from({ length: 251 }, (_, i) => compact(i));
  const completion = controller.ensureRows(rows, { retainAll: true });
  for (let index = 0; index < 3; index++) {
    await flush();
    assert.equal(h.calls.length, index + 1);
    assert.ok(h.calls[index].body.item_ids.length <= 100);
    replyRows(h.calls[index]);
  }
  await completion;
  assert.equal(rows.filter(row => row.__details_loaded).length, 251);
  controller.releaseExcept(rows.slice(-20));
  assert.equal(rows.filter(row => row.__details_loaded).length, 20);
  assert.equal(rows.at(-1).output_full, 'answer 250');
}

async function globalConcurrencyAndAbort() {
  const h = harness();
  const controllers = Array.from({ length: 9 }, () => h.create());
  const rows = controllers.map((_, id) => compact(id));
  const promises = controllers.map((controller, id) => controller.ensureRows([rows[id]]));
  const completion = Promise.allSettled(promises);
  assert.equal(h.calls.length, 3);
  controllers[8].stop(); // A queued request must also respect cancellation.
  for (let i = 0; i < 8; i++) {
    await flush();
    replyRows(h.calls[i]);
  }
  const result = await completion;
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 8);
  assert.equal(result[8].status, 'rejected');
  assert.equal(h.maximum(), 3);
  assert.equal(rows[8].__details_loaded, false);
  assert.equal(controllers[8].ensureRows([rows[8]]), null);
  assert.equal(controllers[8].ensureSearch([{ field: 'output', value: 'answer' }]), null);
  const active = h.create();
  const row = compact(42);
  const pending = active.ensureRows([row]);
  active.stop();
  await assert.rejects(pending, /aborted/);
  assert.equal(row.__details_loaded, false);
}

async function searchRacesAndFailures() {
  const h = harness();
  const controller = h.create({ passNumber: 2 });
  const older = { field: 'content', value: 'Older' };
  const newer = { field: 'output', value: 'Newer' };
  const first = controller.ensureSearch([older]);
  const duplicate = controller.ensureSearch([{ ...older, value: 'OLDER' }]);
  const second = controller.ensureSearch([newer]);
  await flush();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[0].body.pass_numbers, [2]);
  assert.equal(h.calls[0].body.pass_number, undefined);
  replyMatches(h.calls[1], { 0: ['2'] });
  await second;
  replyMatches(h.calls[0], { 0: ['1'] });
  await Promise.all([first, duplicate]);
  assert.equal(controller.matches(older, compact(1)), true);
  assert.equal(controller.matches(newer, compact(1)), false);
  assert.equal(controller.matches(newer, compact(2)), true);
  assert.equal(controller.ensureSearch([older, newer]), null);

  const conditions = Array.from({ length: 65 }, (_, i) => ({ field: 'all', value: 'term ' + i }));
  const batches = controller.ensureSearch(conditions);
  for (let i = 0; i < 3; i++) {
    await flush();
    const call = h.calls[2 + i];
    assert.ok(call.body.conditions.length <= 32);
    replyMatches(call, Object.fromEntries(call.body.conditions.map(c => [c.id, ['7']])));
  }
  await batches;
  assert.ok(conditions.every(c => controller.matches(c, compact(7))));

  const invalid = { field: 'all', value: 'invalid' };
  const missing = controller.ensureSearch([invalid]);
  await flush();
  h.calls.at(-1).reply({ matches_by_pass: {} });
  await assert.rejects(missing, /Incomplete/);
  const retry = controller.ensureSearch([invalid]);
  await flush();
  replyMatches(h.calls.at(-1), { 0: ['8'] });
  await retry;
  assert.equal(controller.matches(invalid, compact(8)), true);

  const row = compact(9);
  const failure = controller.ensureRows([row]);
  h.calls.at(-1).reply({ error: 'unavailable' }, 503);
  await assert.rejects(failure, /503/);
  const absent = controller.ensureRows([row]);
  h.calls.at(-1).reply({ rows: [] });
  await assert.rejects(absent, /no longer available/);
  assert.equal(row.__details_loaded, false);
  const repaired = controller.ensureRows([row]);
  replyRows(h.calls.at(-1));
  await repaired;
  assert.equal(row.output_full, 'answer 9');
}

async function passColumnsShareOneRequest() {
  const h = harness();
  // Compare opens one loader per pass column of a repeat run. The details
  // endpoint returns every pass, so they must share one request per item.
  const passes = Array.from({ length: 12 }, (_, i) => i + 1);
  const controllers = passes.map(pass => h.create({
    passNumber: pass,
    transformRow: row => ({ ...row, output_full: row.pass_attempts[0].output + ' pass ' + pass, pass_attempts: null }),
  }));
  const columns = passes.map(() => Array.from({ length: 20 }, (_, i) => compact(i)));
  const loads = controllers.map((controller, i) => controller.ensureRows(columns[i]));
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.item_ids.length, 20);
  replyRows(h.calls[0]);
  await Promise.all(loads);
  columns.forEach((rows, i) => {
    assert.equal(rows[3].output_full, 'attempt 3 pass ' + (i + 1));
    assert.equal(rows[3].__details_loaded, true);
  });
  // Pass columns share the fetched row's nested objects. Releasing one column
  // must not strip judge output from another column that is still open.
  assert.equal(columns[0][3].metric_meta, columns[1][3].metric_meta);
  controllers[0].releaseExcept([]);
  assert.equal(JSON.stringify(columns[0][3].metric_meta), JSON.stringify({ accuracy: { modified: true } }));
  assert.equal(columns[1][3].metric_meta.accuracy.llm_result.length, 5000);
  assert.equal(columns[1][3].metric_meta.accuracy.explanation, 'judge 3');
  // Another run is a different key, and a later page is a new request.
  const other = h.create({ runId: 'run/2' });
  const otherLoad = other.ensureRows([compact(3)]);
  const nextPage = controllers.map(controller => controller.ensureRows([compact(40)]));
  await flush();
  assert.equal(h.calls.length, 3);
  assert.match(h.calls[1].url, /run%2F2\/items\/details$/);
  replyRows(h.calls[1]);
  replyRows(h.calls[2]);
  await Promise.all([otherLoad, ...nextPage]);

  // A loader waiting on a stopped owner's request fetches the rows itself.
  const owner = h.create();
  const waiter = h.create();
  const ownerRow = compact(50);
  const waiterRow = compact(50);
  const ownerLoad = owner.ensureRows([ownerRow]);
  const waiterLoad = waiter.ensureRows([waiterRow]);
  await flush();
  assert.equal(h.calls.length, 4);
  owner.stop();
  await assert.rejects(ownerLoad, /aborted/);
  await flush();
  assert.equal(h.calls.length, 5);
  assert.deepEqual(h.calls[4].body.item_ids, ['50']);
  replyRows(h.calls[4]);
  await waiterLoad;
  assert.equal(waiterRow.output_full, 'answer 50');
  assert.equal(ownerRow.__details_loaded, false);
}

async function passColumnsShareOneSearch() {
  const h = harness();
  const condition = { field: 'output', value: 'needle' };
  const columns = [1, 2, 3].map(pass => h.create({ passNumber: pass }));
  const other = h.create({ runId: 'run/2', passNumber: 1 });
  const aggregate = h.create();
  const searches = [...columns, other, aggregate].map(controller => controller.ensureSearch([condition]));
  await flush();
  // One request for the run's three pass columns, one for the other run and
  // one for the aggregate loader (which searches without passes).
  assert.equal(h.calls.length, 3);
  const plain = h.calls.find(call => !call.body.pass_numbers);
  const otherRun = h.calls.find(call => /run%2F2/.test(call.url));
  const shared = h.calls.find(call => call !== plain && call !== otherRun);
  assert.deepEqual(shared.body.pass_numbers, [1, 2, 3]);
  assert.match(otherRun.url, /run%2F2\/items\/search$/);
  assert.deepEqual(otherRun.body.pass_numbers, [1]);
  assert.equal(plain.body.pass_numbers, undefined);
  shared.reply({ matches_by_pass: { 1: { 0: ['a'] }, 2: { 0: ['b'] }, 3: { 0: [] } } });
  replyMatches(otherRun, { 0: ['c'] });
  replyMatches(plain, { 0: ['d'] });
  await Promise.all(searches);
  assert.equal(columns[0].matches(condition, compact('a')), true);
  assert.equal(columns[0].matches(condition, compact('b')), false);
  assert.equal(columns[1].matches(condition, compact('b')), true);
  assert.equal(columns[2].matches(condition, compact('a')), false);
  assert.equal(other.matches(condition, compact('c')), true);
  assert.equal(aggregate.matches(condition, compact('d')), true);

  // A column waiting on a stopped column's request searches again alone.
  const next = { field: 'all', value: 'next' };
  const ownerSearch = columns[0].ensureSearch([next]);
  const waiterSearch = columns[1].ensureSearch([next]);
  await flush();
  assert.equal(h.calls.length, 4);
  assert.deepEqual(h.calls[3].body.pass_numbers, [1, 2]);
  columns[0].stop();
  await assert.rejects(ownerSearch, /aborted/);
  await flush();
  assert.equal(h.calls.length, 5);
  assert.deepEqual(h.calls[4].body.pass_numbers, [2]);
  replyMatches(h.calls[4], { 0: ['e'] });
  await waiterSearch;
  assert.equal(columns[1].matches(next, compact('e')), true);
}

(async () => {
  await passColumnsShareOneRequest();
  await passColumnsShareOneSearch();
  await deduplicationAndEviction();
  await batchingAndRetention();
  await globalConcurrencyAndAbort();
  await searchRacesAndFailures();
  process.stdout.write('Run details contracts passed: shared pass-column requests and searches, deduplication, batches, LRU, edits, global concurrency, aborts, races, retry, missing patches.\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
