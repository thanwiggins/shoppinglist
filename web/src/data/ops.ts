import { DEFAULTS, type Op, type RowTypes, type TableName, type Tables } from './types';

export function newId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return `${prefix}_${s}`;
}

export const nowIso = () => new Date().toISOString();

export function upsert<T extends TableName>(table: T, id: string, fields: Partial<RowTypes[T]>): Op {
  return { kind: 'upsert', table, id, fields: fields as Record<string, unknown>, at: nowIso() };
}

export function remove(table: TableName, id: string): Op {
  return { kind: 'delete', table, id, at: nowIso() };
}

/**
 * Applies ops to a copy of the tables (copy-on-write per table and per row),
 * so React sees new references only where something changed.
 * Deleted rows are dropped from the local view entirely.
 */
export function applyOps(tables: Tables, ops: Op[]): Tables {
  if (!ops.length) return tables;
  const next = { ...tables } as Tables;
  const copied = new Set<TableName>();
  const tableFor = <T extends TableName>(name: T): Record<string, RowTypes[T]> => {
    if (!copied.has(name)) {
      (next as Record<string, unknown>)[name] = { ...tables[name] };
      copied.add(name);
    }
    return next[name] as Record<string, RowTypes[T]>;
  };
  for (const op of ops) {
    const tbl = tableFor(op.table);
    if (op.kind === 'delete') {
      delete tbl[op.id];
    } else {
      const existing = tbl[op.id] as unknown as Record<string, unknown> | undefined;
      const base = existing ?? { id: op.id, ...DEFAULTS[op.table] };
      tbl[op.id] = { ...base, ...op.fields, id: op.id, updated_at: op.at } as never;
    }
  }
  return next;
}

/** Replaces rows with the server's copies (server is the source of truth for confirmed data). */
export function mergeServerRows(tables: Tables, changes: Partial<Record<TableName, Array<{ id: string; deleted?: boolean }>>>): Tables {
  const next = { ...tables } as Tables;
  for (const [name, rows] of Object.entries(changes) as [TableName, Array<{ id: string; deleted?: boolean }>][]) {
    if (!rows || !next[name]) continue;
    const tbl = { ...next[name] } as Record<string, unknown>;
    for (const row of rows) {
      if (row.deleted) delete tbl[row.id];
      else tbl[row.id] = row;
    }
    (next as Record<string, unknown>)[name] = tbl;
  }
  return next;
}
