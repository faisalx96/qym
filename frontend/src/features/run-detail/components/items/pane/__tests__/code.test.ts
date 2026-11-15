/** The code helpers of the item pane: the SQL layout changes white space only, keywords and JSON tokens are classed. */
import { describe, expect, it } from 'vitest';
import { formatSql, jsonTokens, looksLikeSql, sqlWords } from '../code';

const flat = (s: string) => s.replace(/\s+/g, '');

describe('looksLikeSql', () => {
  it('takes a statement that starts with a SQL verb and names a source', () => {
    expect(looksLikeSql('SELECT id FROM orders')).toBe(true);
    expect(looksLikeSql('  with t as (select 1) select * from t')).toBe(true);
    expect(looksLikeSql('insert into t values (1)')).toBe(true);
  });
  it('refuses prose, and a verb with no source', () => {
    expect(looksLikeSql('Select the best answer for the customer')).toBe(false);
    expect(looksLikeSql('The update is late')).toBe(false);
    expect(looksLikeSql('select 1')).toBe(false);
  });
});

describe('formatSql', () => {
  it('puts each clause of a one-line query on its own line', () => {
    const out = formatSql(
      "SELECT id, total FROM orders WHERE status = 'open' AND total > 10 GROUP BY id ORDER BY total DESC LIMIT 5",
    );
    expect(out.split('\n')).toEqual([
      'SELECT id, total',
      'FROM orders',
      "WHERE status = 'open'",
      '  AND total > 10',
      'GROUP BY id',
      'ORDER BY total DESC',
      'LIMIT 5',
    ]);
  });

  it('changes white space only', () => {
    const sql =
      "select o.id, count(*) as n from orders o left join users u on u.id = o.user_id where o.created between '2026-01-01' and '2026-02-01' and u.tier in ('gold', 'silver') group by o.id having count(*) > 1";
    const out = formatSql(sql);
    expect(out).not.toBe(sql);
    expect(flat(out)).toBe(flat(sql));
    // the AND of BETWEEN stays on the line of its filter
    expect(out).toContain("between '2026-01-01' and '2026-02-01'");
    expect(out.split('\n').some((l) => /^left join /.test(l))).toBe(true);
  });

  it('indents a sub-query under the line that opens it', () => {
    const out = formatSql('select * from (select id from orders where total > 5) t where t.id > 1');
    const lines = out.split('\n');
    expect(lines).toContain('  select id');
    expect(lines).toContain('  from orders');
    expect(lines[lines.length - 1]).toBe('where t.id > 1');
  });

  it('puts each expression of a long SELECT on its own line', () => {
    const out = formatSql(
      'select customer_id, sum(amount) as total_amount, count(*) as order_count, max(created_at) as last_order from orders',
    );
    expect(out.split('\n').slice(0, 4)).toEqual([
      'select customer_id,',
      '  sum(amount) as total_amount,',
      '  count(*) as order_count,',
      '  max(created_at) as last_order',
    ]);
  });

  it('returns a query that has line breaks, and a text that is not SQL, as recorded', () => {
    const multi = 'select id\nfrom orders';
    expect(formatSql(multi)).toBe(multi);
    expect(formatSql('Select the best answer')).toBe('Select the best answer');
  });

  it('does not break a keyword inside a quoted string', () => {
    const sql = "select id from notes where body = 'a from b where c'";
    expect(formatSql(sql).split('\n')).toEqual([
      'select id',
      'from notes',
      "where body = 'a from b where c'",
    ]);
  });
});

describe('sqlWords', () => {
  it('marks keywords and leaves a keyword inside a string plain', () => {
    const words = sqlWords("select name from t where x = 'select from'", { inString: false });
    expect(words.filter((w) => w.keyword).map((w) => w.text.toLowerCase())).toEqual([
      'select',
      'from',
      'where',
    ]);
    expect(words.map((w) => w.text).join('')).toBe("select name from t where x = 'select from'");
  });
  it('carries an open quote from one piece to the next', () => {
    const state = { inString: false };
    sqlWords("where x = 'from", state);
    expect(state.inString).toBe(true);
    expect(sqlWords(' select', state).some((w) => w.keyword)).toBe(false);
  });
});

describe('jsonTokens', () => {
  it('classes keys, strings, numbers, booleans, null and punctuation, and keeps the text', () => {
    const text = JSON.stringify({ name: 'a "b"', n: -1.5e3, ok: true, none: null, list: [1] }, null, 2);
    const tokens = jsonTokens(text);
    expect(tokens.map((t) => t.text).join('')).toBe(text);
    const of = (kind: string) => tokens.filter((t) => t.kind === kind).map((t) => t.text);
    expect(of('key')).toEqual(['"name"', '"n"', '"ok"', '"none"', '"list"']);
    expect(of('string')).toEqual(['"a \\"b\\""']);
    expect(of('number')).toEqual(['-1500', '1']);
    expect(of('boolean')).toEqual(['true']);
    expect(of('null')).toEqual(['null']);
    expect(of('punct')).toContain('{');
  });
});
