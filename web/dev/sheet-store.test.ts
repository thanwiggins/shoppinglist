/**
 * Tests apps-script/Store.js against a fake spreadsheet, so changes to how the
 * db_* tabs are read and written are checked before they touch the real sheet.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(join(here, '../../apps-script', f), 'utf8');

type Cell = unknown;

class FakeSheet {
  grid: Cell[][] = [];
  maxRows = 1000;
  maxCols = 26;
  formats = new Map<number, string>(); // column → number format
  constructor(public name: string) {}
  getLastRow() {
    for (let r = this.grid.length - 1; r >= 0; r--) if ((this.grid[r] ?? []).some((v) => v !== '' && v != null)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const row of this.grid) for (let c = (row ?? []).length - 1; c >= 0; c--) if (row[c] !== '' && row[c] != null) { max = Math.max(max, c + 1); break; }
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_after: number, n: number) { this.maxRows += n; }
  insertColumnsAfter(_after: number, n: number) { this.maxCols += n; }
  setFrozenRows() {}
  getRange(r: number, c: number, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || r + nr - 1 > this.maxRows || c + nc - 1 > this.maxCols) throw new Error(`range out of bounds ${r},${c},${nr},${nc}`);
    const sheet = this;
    const range = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sheet.grid[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: (v: Cell[][]) => {
        if (v.length !== nr || v.some((row) => row.length !== nc)) throw new Error('setValues dimension mismatch');
        v.forEach((row, i) => row.forEach((val, j) => {
          const rr = r - 1 + i, cc = c - 1 + j;
          sheet.grid[rr] = sheet.grid[rr] ?? [];
          // A plain-text column keeps strings as typed; elsewhere Sheets would turn ISO dates into Dates.
          const isText = sheet.formats.get(cc + 1) === '@';
          sheet.grid[rr][cc] = !isText && typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val) ? new Date(val) : val;
        }));
        return range;
      },
      clearContent: () => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sheet.grid[r - 1 + i]) sheet.grid[r - 1 + i][c - 1 + j] = '';
        return range;
      },
      setNumberFormat: (f: string) => { for (let j = 0; j < nc; j++) sheet.formats.set(c + j, f); return range; },
      setFontWeight: () => range
    };
    return range;
  }
}

function load() {
  const ctx: Record<string, unknown> = { console };
  vm.createContext(ctx);
  vm.runInContext(src('Core.js'), ctx);
  vm.runInContext(src('Store.js'), ctx);
  const sheets = new Map<string, FakeSheet>();
  const ss = {
    getSheetByName: (n: string) => sheets.get(n) ?? null,
    insertSheet: (n: string) => { const s = new FakeSheet(n); sheets.set(n, s); return s; }
  };
  return { ctx: ctx as Record<string, (...a: unknown[]) => unknown>, ss, sheets };
}

describe('Store.js (db_* tabs)', () => {
  it('reads a tab written before a column was added, then rewrites it in the new layout', () => {
    const { ctx, ss } = load();
    // db_trip_items as it was before trip_items.sort existed.
    const oldCols = ['id', 'trip_id', 'product_id', 'section_id', 'qty', 'source', 'status', 'price', 'updated_at', 'deleted', '_v'];
    const sheet = ss.insertSheet('db_trip_items');
    oldCols.forEach((_, i) => sheet.formats.set(i + 1, ['id', 'trip_id', 'product_id', 'section_id', 'source', 'status', 'updated_at'].includes(oldCols[i]) ? '@' : ''));
    sheet.grid = [oldCols, ['ti_1', 't_1', 'p_1', 'sec_dinner', 2, 'meal', 'in_cart', 0, '2026-11-06T17:30:43.480Z', false, 4]];

    const before = ctx.db_readTable_(ss, 'trip_items') as Record<string, Record<string, unknown>>;
    expect(before.ti_1).toMatchObject({ qty: 2, source: 'meal', status: 'in_cart', updated_at: '2026-11-06T17:30:43.480Z', _v: 4, sort: 0 });

    before.ti_1.sort = 3;
    ctx.db_writeTable_(ss, 'trip_items', before);
    expect(sheet.grid[0]).toEqual(ctx.coreColumns('trip_items'));
    expect(sheet.grid[0]).toContain('sort');

    const after = ctx.db_readTable_(ss, 'trip_items') as Record<string, Record<string, unknown>>;
    expect(after.ti_1).toMatchObject({ qty: 2, source: 'meal', status: 'in_cart', sort: 3, updated_at: '2026-11-06T17:30:43.480Z', _v: 4, deleted: false });
  });

  it('creates new tabs with a header and round-trips every table', () => {
    const { ctx, ss } = load();
    const row = (ctx.coreNormalizeRow as (t: string, p: object) => Record<string, unknown>)('products', { id: 'p_1', name: '1/2 Gallon Milk', price: 3.5, dept_id: 'd_1', updated_at: '2026-11-06T10:00:00.000Z', _v: 2 });
    ctx.db_writeTable_(ss, 'products', { p_1: row });
    const back = ctx.db_readTable_(ss, 'products') as Record<string, unknown>;
    expect(back).toEqual({ p_1: row });
  });

  it('shrinks the table when rows are removed', () => {
    const { ctx, ss, sheets } = load();
    const mk = (id: string) => (ctx.coreNormalizeRow as (t: string, p: object) => object)('departments', { id, name: id, walk_order: 1 });
    ctx.db_writeTable_(ss, 'departments', { a: mk('a'), b: mk('b'), c: mk('c') });
    ctx.db_writeTable_(ss, 'departments', { a: mk('a') });
    expect(Object.keys(ctx.db_readTable_(ss, 'departments') as object)).toEqual(['a']);
    expect(sheets.get('db_departments')!.getLastRow()).toBe(2);
  });
});
