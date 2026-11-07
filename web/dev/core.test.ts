import { describe, expect, it } from 'vitest';
import { core, sampleDb, sampleLegacy } from '../src/test/helpers';

describe('Core migration', () => {
  const { tables, report } = core.coreMigrateLegacy(sampleLegacy(), '2026-11-06T12:00:00.000Z');
  const name = (id: string) => tables.products.find((p: { id: string }) => p.id === id).name;

  it('reproduces the Shopping List total', () => {
    expect(report.legacyTotal).toBe(89.5);
    expect(report.newTotal).toBe(89.5);
    expect(report.unknownNames).toEqual([]);
  });

  it('takes staples from the recurring rows only', () => {
    const supplies = tables.staples.filter((s: { section_id: string }) => s.section_id === 'sec_supplies').map((s: { product_id: string }) => name(s.product_id));
    expect(supplies).toEqual(['Diapers', 'Wipes', 'Paper Towels']);
    const dinner = tables.staples.filter((s: { section_id: string }) => s.section_id === 'sec_dinner').map((s: { product_id: string }) => name(s.product_id));
    expect(dinner).toEqual(['Ice Cream, Vanilla', 'Mustard']);
  });

  it('labels where each list item came from and carries check marks', () => {
    const by = Object.fromEntries(tables.trip_items.map((i: { product_id: string }) => [name(i.product_id), i]));
    expect(by['Diapers']).toMatchObject({ source: 'staple', status: 'in_cart' });
    expect(by['Dish Soap']).toMatchObject({ source: 'added', status: 'todo' });
    expect(by['Pizza']).toMatchObject({ source: 'meal', qty: 2 });
    expect(by['Cheese Slices']).toMatchObject({ source: 'added' });
    expect(by['Bananas']).toMatchObject({ source: 'added', qty: 6 });
  });

  it('turns purchase dates into history and base ingredients into pantry items', () => {
    const apples = tables.products.find((p: { name: string }) => p.name === 'Apples');
    expect(tables.purchases.filter((p: { product_id: string }) => p.product_id === apples.id)).toHaveLength(3);
    const tacos = tables.meals.find((m: { name: string }) => m.name === 'Tacos');
    const items = tables.meal_items.filter((mi: { meal_id: string }) => mi.meal_id === tacos.id);
    expect(items.filter((i: { pantry: boolean }) => i.pantry).map((i: { product_id: string }) => name(i.product_id)).sort())
      .toEqual(['Cheddar Cheese', 'Fresh Tortillas', 'Salsa']);
  });

  it('merges duplicate product names', () => {
    const legacy = sampleLegacy();
    legacy.products.push(['Apples', 0.5, 'Produce', '2026-01-02', '', '', '', 0, 0]);
    const r = core.coreMigrateLegacy(legacy, '2026-11-06T12:00:00.000Z');
    expect(r.report.duplicatesMerged).toEqual(['Apples']);
    expect(r.tables.products.filter((p: { name: string }) => p.name === 'Apples')).toHaveLength(1);
  });
});

describe('Core sync', () => {
  it('applies ops idempotently and reports only newer rows', () => {
    const db = sampleDb();
    const pid = Object.keys(db.tables.products)[0];
    const ops = [{ kind: 'upsert', table: 'products', id: pid, fields: { price: 9.99, bogus: 1, _v: 999 }, at: 'x' }];
    core.coreApplyOps(db, ops, 'now');
    expect(db.version).toBe(2);
    expect(db.tables.products[pid].price).toBe(9.99);
    expect(db.tables.products[pid]._v).toBe(2);
    expect(db.tables.products[pid].bogus).toBeUndefined();
    core.coreApplyOps(db, ops, 'now'); // a resend after a dropped reply
    expect(db.tables.products[pid].price).toBe(9.99);
    const changes = core.coreChangesSince(db, 2);
    expect(Object.keys(changes)).toEqual(['products']);
    expect(changes.products).toHaveLength(1);
    expect(core.coreChangesSince(db, 3)).toEqual({});
  });

  it('soft-deletes so other devices hear about it', () => {
    const db = sampleDb();
    const sid = Object.keys(db.tables.staples)[0];
    core.coreApplyOps(db, [{ kind: 'delete', table: 'staples', id: sid, at: 'x' }], 'now');
    expect(core.coreChangesSince(db, 1).staples[0]).toMatchObject({ id: sid, deleted: true });
    expect(core.coreSnapshot(db).staples.find((s: { id: string }) => s.id === sid)).toBeUndefined();
  });

  it('coerces sheet values back to their types', () => {
    const row = core.coreRowFromArray('products', ['p_1', 'Milk', '3.50', 'd_1', '', 'https://example.com/milk.jpg', 'TRUE', '2026-01-01', 'FALSE', '4']);
    expect(row).toMatchObject({ price: 3.5, link: 'https://example.com/milk.jpg', active: true, deleted: false, _v: 4 });
    expect(core.coreRowFromArray('purchases', ['pu_1', 'p_1', new Date(2026, 9, 29), 1, 2, '', '', false, 1]).date).toBe('2026-10-29');
  });

  it('rejects ops for unknown tables', () => {
    const db = sampleDb();
    expect(() => core.coreApplyOps(db, [{ kind: 'upsert', table: 'nope', id: 'x', fields: {} }], 'now')).toThrow();
  });
});
