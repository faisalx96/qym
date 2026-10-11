import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/http';
import { mapEnvironmentError } from '../fieldErrors';

const err = (status: number, detail: unknown) =>
  new ApiError(status, typeof detail === 'string' ? detail : JSON.stringify(detail), { body: { detail } });

describe('mapEnvironmentError', () => {
  it('places URL problems on the Base URL field', () => {
    expect(mapEnvironmentError(err(400, 'Environment URL must use https://. Set QYM_ALLOW...')).fields.base_url).toMatch(/https/);
    expect(mapEnvironmentError(err(502, 'Evaluation service endpoint not found; check the base URL (include EVAL_SERVER_PREFIX, not /evals)')).fields.base_url).toBeTruthy();
  });
  it('places key problems on the API key field', () => {
    expect(mapEnvironmentError(err(400, 'Evaluation service rejected the environment API key')).fields.api_key).toBeTruthy();
  });
  it('places a duplicate name on the Name field', () => {
    expect(mapEnvironmentError(err(409, 'An environment with that name already exists')).fields.name).toBeTruthy();
    expect(mapEnvironmentError(err(400, 'A name is required')).fields.name).toBeTruthy();
  });
  it('maps pydantic locations', () => {
    const r = mapEnvironmentError(err(422, [{ loc: ['body', 'ranking_k'], msg: 'ensure this value is >= 1' }]));
    expect(r.fields.ranking_k).toMatch(/>= 1/);
    expect(r.general).toBe('');
  });
  it('keeps unrelated errors as a general message', () => {
    const r = mapEnvironmentError(err(500, 'Something broke'));
    expect(r.fields).toEqual({});
    expect(r.general).toBe('Something broke');
  });
});
