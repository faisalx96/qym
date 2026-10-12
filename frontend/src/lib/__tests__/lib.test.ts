import { describe, expect, it, beforeEach, vi } from 'vitest';
import { applyQueryUpdates } from '@/lib/url-state';
import { classifyError, ApiError, sameOriginTarget } from '@/lib/http';
import { getMetricColorClass, metricDirection, parseScoreValue, scoreBand, getRowScore } from '@/lib/metrics';
import { isRTL, looksLikeCode, renderMarkdown, textDirAttrs } from '@/lib/text';
import { identiconModel } from '@/lib/identicon';
import { announceRunStatus, subscribeRunStatus, RUN_STATUS_EVENT } from '@/lib/run-status';
import { _resetBootstrap, appBase, appUrl, bootstrap, platformUrl } from '@/lib/runtime';

describe('runtime bootstrap', () => {
  beforeEach(() => {
    _resetBootstrap();
    delete window.__QYM_APP__;
    delete window.__QYM_ROOT_PATH__;
  });
  it('defaults to the dev proxy shape', () => {
    expect(bootstrap()).toEqual({ rootPath: '', authMode: 'none', sessionAuth: false, environment: 'dev' });
    expect(appBase()).toBe('/');
    expect(appUrl('/projects/x')).toBe('/projects/x');
    expect(appUrl('/')).toBe('/');
    expect(platformUrl('/v1/me')).toBe('/v1/me');
  });
  it('reads the injected root path', () => {
    window.__QYM_APP__ = {
      rootPath: '/qym/',
      authMode: 'oidc',
      sessionAuth: true,
      environment: 'production',
    };
    expect(bootstrap().rootPath).toBe('/qym');
    expect(appBase()).toBe('/qym');
    expect(platformUrl('v1/me')).toBe('/qym/v1/me');
    expect(appUrl('/')).toBe('/qym/');
    expect(appUrl('/projects/x')).toBe('/qym/projects/x');
  });
});

describe('url state', () => {
  it('sets, deletes and keeps params', () => {
    const next = applyQueryUpdates(new URLSearchParams('a=1&b=2'), { a: null, c: 3, d: true, e: '', b: 'x' });
    expect(next.toString()).toBe('b=x&c=3&d=1');
  });
});

describe('http errors', () => {
  it('classifies by status and name', () => {
    expect(classifyError(new ApiError(401, 'no')).kind).toBe('auth');
    expect(classifyError(new ApiError(403, 'no')).kind).toBe('forbidden');
    expect(classifyError(new ApiError(404, 'no')).kind).toBe('not_found');
    expect(classifyError(new ApiError(500, 'no')).kind).toBe('server');
    expect(classifyError(new ApiError(422, 'no')).kind).toBe('client');
    expect(classifyError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(classifyError({ name: 'AbortError' }).kind).toBe('abort');
    expect(classifyError(new Error('?')).kind).toBe('unknown');
    expect(classifyError(new ApiError(404, 'Run not found')).detail).toBe('Run not found');
  });
  it('only follows same-site next targets', () => {
    expect(sameOriginTarget('/profile', '/x')).toBe('/profile');
    expect(sameOriginTarget('//evil.test', '/x')).toBe('/x');
    expect(sameOriginTarget('https://evil.test', '/x')).toBe('/x');
    expect(sameOriginTarget('/\\evil', '/x')).toBe('/x');
    expect(sameOriginTarget('', '/x')).toBe('/x');
  });
});

describe('metrics', () => {
  it('parses values and bands', () => {
    expect(parseScoreValue('83%')).toBeCloseTo(0.83);
    expect(parseScoreValue('✓')).toBe(1);
    expect(parseScoreValue('n/a')).toBeNull();
    expect(scoreBand(0.95)).toBe(5);
    expect(scoreBand(0.1)).toBe(1);
    expect(getMetricColorClass(0.9, 'score', 'maximize')).toBe('score-5');
    expect(getMetricColorClass(0.1, 'score', 'minimize')).toBe('score-5');
    expect(getMetricColorClass(0.9, 'numeric', 'maximize')).toBe('');
    expect(getMetricColorClass(0.9, 'score', null)).toBe('');
  });
  it('reads direction from specs', () => {
    expect(metricDirection({ direction: 'maximize' })).toBe('maximize');
    expect(metricDirection({ direction: 'maximize', score_type: 'legacy', schema_version: 1 })).toBeNull();
    expect(metricDirection({ direction: 'minimize' })).toBe('minimize');
    expect(metricDirection(null)).toBeNull();
  });
  it('scores rows with errors by direction', () => {
    expect(getRowScore({ metric_values: [0.5], status: 'error' }, 0, null, 'maximize')).toEqual({
      score: 0,
      isError: true,
    });
    expect(getRowScore({ metric_values: [0.5], status: 'error' }, 0, null, 'minimize')).toEqual({
      score: null,
      isError: true,
    });
    expect(getRowScore({ metric_values: ['0.5'] }, 0)).toEqual({ score: 0.5, isError: false });
  });
});

describe('text', () => {
  it('detects Arabic direction', () => {
    expect(isRTL('مرحبا بالعالم')).toBe(true);
    expect(isRTL('hello مرحبا world again')).toBe(false);
    expect(textDirAttrs('مرحبا')).toEqual({ dir: 'rtl', lang: 'ar' });
    expect(textDirAttrs('hi')).toEqual({ dir: 'auto' });
  });
  it('detects code', () => {
    expect(looksLikeCode('SELECT a FROM b')).toBe(true);
    expect(looksLikeCode('def f():\n    return 1\n')).toBe(true);
    expect(looksLikeCode('Just a sentence.')).toBe(false);
  });
  it('renders a safe markdown subset', () => {
    const html = renderMarkdown('# T\n**b** `c` <script>x</script> https://a.b');
    expect(html).toContain('<strong class="qym-text__heading">T</strong>');
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://a.b"');
  });
});

describe('identicon', () => {
  it('is deterministic and symmetric', () => {
    const a = identiconModel('project-a');
    expect(identiconModel('project-a')).toEqual(a);
    expect(a.rows).toHaveLength(5);
    for (const row of a.rows) {
      expect(row[0]).toBe(row[4]);
      expect(row[1]).toBe(row[3]);
    }
    expect(a.rows.flat().filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });
});

describe('run status bus', () => {
  it('notifies subscribers and the document', () => {
    const listener = vi.fn();
    const off = subscribeRunStatus(listener);
    const docListener = vi.fn();
    document.addEventListener(RUN_STATUS_EVENT, docListener);
    announceRunStatus(['r1'], 'STOPPED');
    expect(listener).toHaveBeenCalledWith({ runIds: ['r1'], status: 'STOPPED' });
    expect(docListener).toHaveBeenCalled();
    off();
    document.removeEventListener(RUN_STATUS_EVENT, docListener);
  });
});
