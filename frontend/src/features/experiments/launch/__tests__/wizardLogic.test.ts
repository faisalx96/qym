import { describe, expect, it } from 'vitest';
import { homeStatus } from '../entry/HomeBar';
import { entryKey, locationKey } from '../state/useStep';
import { heldOnHome, parseStep, stepOfItem, stepOfSection } from '../wizard/steps';
import type { ValidationItem } from '../model';

const item = (over: Partial<ValidationItem>): ValidationItem => ({
  pointer: '',
  label: 'x',
  message: 'm',
  stepId: 'where',
  fieldName: 'f',
  where: [],
  source: 'local',
  ...over,
});

describe('wizard steps', () => {
  it('parses ?step=: absent is home, unknown is step 1', () => {
    expect(parseStep(null)).toBeNull();
    expect(parseStep('models')).toBe('models');
    expect(parseStep('nonsense')).toBe('where');
    expect(parseStep('')).toBe('where');
  });

  it('maps sections and review items to steps', () => {
    expect(stepOfSection('sweeps')).toBe('settings');
    expect(stepOfSection('raw')).toBe('review');
    expect(stepOfItem(item({ stepId: 'models' }))).toBe('models');
    expect(stepOfItem(item({ stepId: 'env', pointer: '/links/0' }))).toBe('settings');
    expect(stepOfItem(item({ stepId: 'eval' }))).toBe('evaluation');
    expect(stepOfItem(item({ stepId: 'start' }))).toBe('start');
    expect(stepOfItem(item({ stepId: 'where' }))).toBe('where');
  });

  it('knows which fields the home view holds', () => {
    expect(heldOnHome(item({ pointer: '/evaluator/dataset' }))).toBe(true);
    expect(heldOnHome(item({ pointer: '/evaluator' }))).toBe(false);
    // QA3-18: the latency gate problem is held on the home view, where the control now lives.
    expect(heldOnHome(item({ pointer: '#latency' }))).toBe(true);
    expect(heldOnHome(item({ pointer: '#description' }))).toBe(false);
  });

  it('keeps ?step= out of the form key and the unsaved-changes comparison', () => {
    expect(entryKey('?env=a&step=models&base=saved')).toBe('env=a&base=saved');
    expect(
      locationKey({ pathname: '/p/new', search: '?env=a&step=start' }) ===
        locationKey({ pathname: '/p/new', search: '?env=a' }),
    ).toBe(true);
    expect(
      locationKey({ pathname: '/p/new', search: '?env=a' }) ===
        locationKey({ pathname: '/p/new', search: '?env=b' }),
    ).toBe(false);
  });
});

describe('home status line', () => {
  const base = {
    envCount: 1,
    loading: false,
    error: '',
    over: false,
    problems: 0,
    baseLabel: 'Default preset v1',
    envNames: 'staging',
  };
  it('covers the six states in order', () => {
    expect(homeStatus({ ...base, envCount: 0 })).toBe('Pick an environment.');
    expect(homeStatus({ ...base, loading: true })).toBe('Checking…');
    expect(homeStatus({ ...base, error: 'Boom' })).toBe('Boom');
    expect(homeStatus({ ...base, over: true })).toBe('Over the run limit');
    expect(homeStatus({ ...base, problems: 2 })).toBe('2 problems to fix');
    expect(homeStatus({ ...base, problems: 1 })).toBe('1 problem to fix');
    expect(homeStatus(base)).toBe('Ready: Default preset v1 on staging');
  });
});
