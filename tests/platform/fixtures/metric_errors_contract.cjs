// Judge verdicts and execution failures must remain distinct in shipped metrics.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(process.argv[2],
  'packages/platform/qym_platform/_static/dashboard/metrics.js'), 'utf8'), context);
const metrics = context.window.QymMetrics;
const plain = value => JSON.parse(JSON.stringify(value));

for (const label of ['failed', 'error', 'timeout', 'FAILED']) {
  const row = {
    status: 'completed', metric_values: [0, 1],
    metric_meta: { quality: { label } },
  };
  assert.equal(metrics.isMetricErrorMeta(row.metric_meta.quality), false, label);
  assert.equal(metrics.hasMetricError(row, 'quality'), false, label);
  assert.equal(metrics.isErrorRow(row), false, label);
  assert.deepEqual(plain(metrics.getRowScore(row, 0, 'quality')), { score: 0, isError: false });
  row.pass_metric_meta = { quality: [{ label }, { label: 'passed' }] };
  assert.equal(metrics.hasMetricError(row, 'quality'), false, label);
}

// A verdict reason is a judged score, not a scorer crash (C010). Only
// meta.status marks an execution error; meta.error alone reads as a reason.
for (const meta of [
  { error: 'Empty output' },
  { is_valid: false, error: 'ERROR near "FROM": syntax error' },
  { reason: 'Empty output' },
  { status: 'success', error: 'ignored' },
]) {
  const row = {
    status: 'completed', metric_values: [0, 1],
    metric_meta: { valid_sql: meta },
  };
  assert.equal(metrics.isMetricErrorMeta(meta), false, JSON.stringify(meta));
  assert.equal(metrics.hasMetricError(row, 'valid_sql'), false);
  assert.equal(metrics.isErrorRow(row), false);
  assert.deepEqual(plain(metrics.getRowScore(row, 0, 'valid_sql')), { score: 0, isError: false });
  row.pass_metric_meta = { valid_sql: [meta, {}] };
  assert.equal(metrics.hasMetricError(row, 'valid_sql'), false);
}
assert.equal(metrics.metricMetaDisplayKey('error', { error: 'Empty output' }), 'reason');
assert.equal(metrics.metricMetaDisplayKey('error', { status: 'error', error: 'boom' }), 'error');
assert.equal(metrics.metricMetaDisplayKey('error', { reason: 'r', error: 'e' }), 'error');
assert.equal(metrics.metricMetaDisplayKey('is_valid', { error: 'x' }), 'is_valid');

for (const meta of [
  { status: 'error', error: '' },
  { status: 'failed' },
  { status: 'timeout' },
  { status: ' Error ', error: 'BusinessRuleError' },
]) {
  const row = {
    status: 'completed', metric_values: [0, 1],
    metric_meta: { broken: meta, healthy: {} },
  };
  assert.equal(metrics.isTaskErrorRow(row), false);
  assert.equal(metrics.isErrorRow(row), true);
  assert.deepEqual(plain(metrics.getRowScore(row, 0, 'broken')), { score: 0, isError: true });
  assert.deepEqual(plain(metrics.getRowScore(row, 1, 'healthy')), { score: 1, isError: false });
  const stats = metrics.calculateItemLevelMetrics({
    runsData: [{ snapshot: { rows: [row] } }], metricName: 'broken',
    getMetricIndex: () => 0, threshold: 0.8,
  });
  assert.equal(stats.failedCount, 1);
  assert.equal(stats.totalScoreSum, 0);
  row.metric_values[0] = 0.5;
  row.metric_meta = {};
  row.pass_metric_meta = { broken: [meta, {}] };
  assert.deepEqual(plain(metrics.getRowScore(row, 0, 'broken')), { score: 0.5, isError: true });
  assert.deepEqual(plain(metrics.getRowScore(row, 1, 'healthy')), { score: 1, isError: false });
}

assert.deepEqual(plain(metrics.getRowScore({ status: 'error', metric_values: [1] }, 0, 'quality')),
  { score: 0, isError: true });
