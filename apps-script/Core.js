/**
 * Aisle core: data schema, sync logic and the one-time migration.
 *
 * This file is plain JavaScript with no Apps Script services, so the exact same
 * code runs in Apps Script (API.js, Store.js) and in Node (the local dev server
 * and the unit tests in web/). Keep it that way: no SpreadsheetApp, Utilities,
 * PropertiesService, etc. in here.
 */

var CORE_SCHEMA = {
  departments: {
    name: { type: 'string', def: '' },
    walk_order: { type: 'number', def: 0 }
  },
  products: {
    name: { type: 'string', def: '' },
    price: { type: 'number', def: 0 },
    dept_id: { type: 'string', def: '' },
    note: { type: 'string', def: '' },
    link: { type: 'string', def: '' },
    active: { type: 'bool', def: true }
  },
  sections: {
    name: { type: 'string', def: '' },
    sort: { type: 'number', def: 0 }
  },
  staples: {
    section_id: { type: 'string', def: '' },
    product_id: { type: 'string', def: '' },
    default_qty: { type: 'number', def: 0 },
    sort: { type: 'number', def: 0 }
  },
  meals: {
    name: { type: 'string', def: '' },
    note: { type: 'string', def: '' },
    active: { type: 'bool', def: true }
  },
  meal_items: {
    meal_id: { type: 'string', def: '' },
    product_id: { type: 'string', def: '' },
    qty: { type: 'number', def: 1 },
    pantry: { type: 'bool', def: false }
  },
  trips: {
    status: { type: 'string', def: 'planning' },
    created: { type: 'string', def: '' },
    date: { type: 'string', def: '' },
    est_total: { type: 'number', def: 0 },
    actual_total: { type: 'number', def: 0 }
  },
  trip_items: {
    trip_id: { type: 'string', def: '' },
    product_id: { type: 'string', def: '' },
    section_id: { type: 'string', def: '' },
    qty: { type: 'number', def: 0 },
    source: { type: 'string', def: 'added' },
    status: { type: 'string', def: 'todo' },
    price: { type: 'number', def: 0 },
    sort: { type: 'number', def: 0 }
  },
  trip_meals: {
    trip_id: { type: 'string', def: '' },
    meal_id: { type: 'string', def: '' }
  },
  purchases: {
    product_id: { type: 'string', def: '' },
    date: { type: 'string', def: '' },
    qty: { type: 'number', def: 1 },
    price: { type: 'number', def: 0 },
    trip_id: { type: 'string', def: '' }
  },
  settings: {
    value: { type: 'string', def: '' }
  }
};

var CORE_SYSTEM_FIELDS = {
  updated_at: { type: 'string', def: '' },
  deleted: { type: 'bool', def: false },
  _v: { type: 'number', def: 0 }
};

var CORE_TABLES = Object.keys(CORE_SCHEMA);

/** Column order used in the Sheet: id, the table's fields, then the system fields. */
function coreColumns(table) {
  return ['id'].concat(Object.keys(CORE_SCHEMA[table]), Object.keys(CORE_SYSTEM_FIELDS));
}

/** The column types for a table, including id and system fields. */
function coreColumnTypes(table) {
  var types = { id: 'string' };
  var fields = CORE_SCHEMA[table];
  Object.keys(fields).forEach(function (k) { types[k] = fields[k].type; });
  Object.keys(CORE_SYSTEM_FIELDS).forEach(function (k) { types[k] = CORE_SYSTEM_FIELDS[k].type; });
  return types;
}

function coreFieldSpec(table, key) {
  if (CORE_SCHEMA[table][key]) return CORE_SCHEMA[table][key];
  if (CORE_SYSTEM_FIELDS[key]) return CORE_SYSTEM_FIELDS[key];
  if (key === 'id') return { type: 'string', def: '' };
  return null;
}

/** Converts a raw value (from a sheet cell or a client op) to the field's type. */
function coreCoerce(type, value, def) {
  if (value === null || value === undefined || value === '') {
    return type === 'string' ? '' : (def === undefined ? (type === 'bool' ? false : 0) : def);
  }
  if (type === 'number') {
    var n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,]/g, ''));
    return isFinite(n) ? Math.round(n * 10000) / 10000 : (def === undefined ? 0 : def);
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') return value;
    var s = String(value).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  if (value instanceof Date) return coreIsoDate(value);
  return String(value);
}

function coreIsoDate(d) {
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/** Builds a complete row from a partial one, filling defaults and coercing types. */
function coreNormalizeRow(table, partial) {
  var row = { id: String(partial.id || '') };
  var fields = CORE_SCHEMA[table];
  Object.keys(fields).forEach(function (k) {
    row[k] = coreCoerce(fields[k].type, partial[k], fields[k].def);
  });
  Object.keys(CORE_SYSTEM_FIELDS).forEach(function (k) {
    row[k] = coreCoerce(CORE_SYSTEM_FIELDS[k].type, partial[k], CORE_SYSTEM_FIELDS[k].def);
  });
  return row;
}

function coreRowFromArray(table, arr) {
  var cols = coreColumns(table);
  var partial = {};
  cols.forEach(function (c, i) { partial[c] = arr[i]; });
  return coreNormalizeRow(table, partial);
}

function coreRowToArray(table, row) {
  return coreColumns(table).map(function (c) { return row[c] === undefined ? '' : row[c]; });
}

function coreNewId(prefix) {
  var s = '';
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (var i = 0; i < 10; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return prefix + '_' + s;
}

/**
 * The in-memory database the API works on.
 *   db = { version: number, tableVersions: {table: number}, tables: {table: {id: row}} }
 * Only the tables an operation needs have to be loaded; `tables[t]` may be absent.
 */
function coreEmptyDb() {
  var tv = {};
  CORE_TABLES.forEach(function (t) { tv[t] = 0; });
  // epoch changes whenever the data is replaced wholesale (a re-migration); devices
  // that see a different epoch throw away their copy and download everything again.
  return { version: 0, epoch: '', tableVersions: tv, tables: {} };
}

/** Which tables a batch of ops touches (so the caller only loads those). */
function coreTablesForOps(ops) {
  var seen = {};
  (ops || []).forEach(function (op) { if (op && CORE_SCHEMA[op.table]) seen[op.table] = true; });
  return Object.keys(seen);
}

/**
 * Applies a batch of client operations. Every op is idempotent:
 *   { kind: 'upsert', table, id, fields: {...}, at }   merge fields into the row, creating it if new
 *   { kind: 'delete', table, id, at }                    soft-delete (other devices learn via pull)
 * The whole batch gets one new version number. Returns the list of tables changed.
 */
function coreApplyOps(db, ops, nowIso) {
  if (!ops || !ops.length) return [];
  var version = db.version + 1;
  var touched = {};
  ops.forEach(function (op, i) {
    if (!op || !CORE_SCHEMA[op.table]) throw coreError('bad_op', 'Unknown table in op ' + i);
    if (!op.id || typeof op.id !== 'string') throw coreError('bad_op', 'Missing id in op ' + i);
    var tbl = db.tables[op.table];
    if (!tbl) throw coreError('internal', 'Table not loaded: ' + op.table);
    var existing = tbl[op.id];
    var at = typeof op.at === 'string' && op.at ? op.at : nowIso;
    if (op.kind === 'delete') {
      if (!existing) return;
      existing.deleted = true;
      existing.updated_at = at;
      existing._v = version;
    } else if (op.kind === 'upsert') {
      var fields = op.fields || {};
      var base = existing || coreNormalizeRow(op.table, { id: op.id });
      var spec = CORE_SCHEMA[op.table];
      Object.keys(fields).forEach(function (k) {
        if (!spec[k]) return; // ignore unknown or system fields
        base[k] = coreCoerce(spec[k].type, fields[k], spec[k].def);
      });
      base.deleted = false;
      base.updated_at = at;
      base._v = version;
      tbl[op.id] = base;
    } else {
      throw coreError('bad_op', 'Unknown op kind in op ' + i);
    }
    touched[op.table] = true;
  });
  var names = Object.keys(touched);
  if (names.length) {
    db.version = version;
    names.forEach(function (t) { db.tableVersions[t] = version; });
  }
  return names;
}

/** Tables that have changed after `since` (so the caller only reads those). */
function coreTablesChangedSince(db, since) {
  return CORE_TABLES.filter(function (t) { return (db.tableVersions[t] || 0) > since; });
}

/** Rows (including soft-deleted ones) changed after `since`, grouped by table. */
function coreChangesSince(db, since) {
  var out = {};
  coreTablesChangedSince(db, since).forEach(function (t) {
    var tbl = db.tables[t] || {};
    var rows = [];
    Object.keys(tbl).forEach(function (id) { if (tbl[id]._v > since) rows.push(tbl[id]); });
    if (rows.length) out[t] = rows;
  });
  return out;
}

/** Every live row in every table: what a new device downloads first. */
function coreSnapshot(db) {
  var out = {};
  CORE_TABLES.forEach(function (t) {
    var tbl = db.tables[t] || {};
    out[t] = Object.keys(tbl).map(function (id) { return tbl[id]; }).filter(function (r) { return !r.deleted; });
  });
  return out;
}

function coreError(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

/* ------------------------------------------------------------------------- */
/* One-time migration from the original spreadsheet tabs                      */
/* ------------------------------------------------------------------------- */

var CORE_LEGACY_LAYOUT = {
  // List Builder: [section name, product column, quantity column, last recurring row]
  // Rows are 1-based sheet rows. Data starts on row 6 and runs to row 57.
  blocks: [
    ['Supplies', 0, 2, 8],
    ['Breakfast', 4, 6, 20],
    ['Lunch', 8, 10, 31],
    ['Dinner', 12, 14, 7]
  ],
  firstRow: 6,
  lastRow: 57
};

/**
 * Converts the original tabs into the new tables.
 *
 * legacy = {
 *   products, departments, meals, listBuilder, shoppingList, dinnerdata
 * } where each is that tab's values as a 2-D array starting at row 1 (headers
 * included), exactly like Range.getValues(). Date cells must already be
 * 'YYYY-MM-DD' strings (the Apps Script wrapper converts them).
 *
 * Returns { tables: {table: rows[]}, report: {...} }.
 */
function coreMigrateLegacy(legacy, nowIso) {
  var today = nowIso.slice(0, 10);
  var report = { duplicatesMerged: [], unknownNames: [], counts: {}, legacyTotal: null, newTotal: 0 };
  var T = {};
  CORE_TABLES.forEach(function (t) { T[t] = []; });
  var make = function (table, fields) {
    var row = coreNormalizeRow(table, fields);
    row.updated_at = nowIso;
    row._v = 1;
    T[table].push(row);
    return row;
  };
  var str = function (v) { return v === null || v === undefined ? '' : String(v).trim(); };
  var num = function (v) { return coreCoerce('number', v, 0); };
  var isDate = function (v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); };

  // Departments
  var deptByName = {};
  var maxWalk = 0;
  (legacy.departments || []).slice(1).forEach(function (r) {
    var name = str(r[1]);
    if (!name || deptByName[name.toLowerCase()]) return;
    var walk = num(r[0]) || (maxWalk + 1);
    maxWalk = Math.max(maxWalk, walk);
    deptByName[name.toLowerCase()] = make('departments', { id: coreNewId('d'), name: name, walk_order: walk }).id;
  });
  var deptId = function (name) {
    name = str(name);
    if (!name) return '';
    var key = name.toLowerCase();
    if (!deptByName[key]) {
      maxWalk += 1;
      deptByName[key] = make('departments', { id: coreNewId('d'), name: name, walk_order: maxWalk }).id;
    }
    return deptByName[key];
  };

  // Products (+ purchase history from Purchase Date 1-3)
  var productByName = {};
  var productDates = {};
  var productRows = {};
  (legacy.products || []).slice(1).forEach(function (r) {
    var name = str(r[0]);
    if (!name) return;
    var key = name.toLowerCase();
    var dates = [r[3], r[4], r[5]].filter(isDate);
    if (productByName[key]) {
      report.duplicatesMerged.push(name);
      dates.forEach(function (d) { productDates[key][d] = true; });
      return;
    }
    var row = make('products', { id: coreNewId('p'), name: name, price: num(r[1]), dept_id: deptId(r[2]), active: true });
    productByName[key] = row.id;
    productRows[row.id] = row;
    productDates[key] = {};
    dates.forEach(function (d) { productDates[key][d] = true; });
  });
  Object.keys(productDates).forEach(function (key) {
    var pid = productByName[key];
    Object.keys(productDates[key]).sort().forEach(function (d) {
      make('purchases', { id: coreNewId('pu'), product_id: pid, date: d, qty: 1, price: productRows[pid].price });
    });
  });
  var productId = function (name, where) {
    name = str(name);
    if (!name) return '';
    var id = productByName[name.toLowerCase()];
    if (!id) report.unknownNames.push(name + ' (' + where + ')');
    return id || '';
  };

  // Sections
  var sectionId = {};
  CORE_LEGACY_LAYOUT.blocks.forEach(function (b, i) {
    sectionId[b[0]] = make('sections', { id: 'sec_' + b[0].toLowerCase(), name: b[0], sort: i + 1 }).id;
  });

  // Staples: the recurring rows at the top of each List Builder block
  var lb = legacy.listBuilder || [];
  var cell = function (rowNum, col) { var r = lb[rowNum - 1]; return r ? r[col] : ''; };
  var stapleKey = {};
  CORE_LEGACY_LAYOUT.blocks.forEach(function (b) {
    var sort = 0;
    for (var rn = CORE_LEGACY_LAYOUT.firstRow; rn <= b[3]; rn++) {
      var pid = productId(cell(rn, b[1]), 'List Builder staples');
      if (!pid || stapleKey[b[0] + pid]) continue;
      stapleKey[b[0] + pid] = true;
      sort += 1;
      make('staples', { id: coreNewId('st'), section_id: sectionId[b[0]], product_id: pid, default_qty: 1, sort: sort });
    }
  });

  // Meals: Ingredient 1-5 in C:G, base (pantry) ingredients from column I onward
  var mealByName = {};
  (legacy.meals || []).slice(1).forEach(function (r) {
    var name = str(r[0]);
    if (!name || mealByName[name.toLowerCase()]) return;
    var meal = make('meals', { id: coreNewId('m'), name: name, active: true });
    mealByName[name.toLowerCase()] = meal.id;
    var items = {};
    var add = function (v, pantry) {
      var pid = productId(v, 'meal ' + name);
      if (!pid) return;
      if (items[pid]) { items[pid].qty += 1; return; }
      items[pid] = make('meal_items', { id: coreNewId('mi'), meal_id: meal.id, product_id: pid, qty: 1, pantry: pantry });
    };
    for (var c = 2; c <= 6; c++) add(r[c], false);
    for (var c2 = 8; c2 < r.length; c2++) add(r[c2], true);
  });

  // The week in progress: List Builder quantities, Shopping List checkboxes, Dinnerdata meals
  var trip = make('trips', { id: coreNewId('t'), status: 'planning', created: today });
  var mealIngredients = {};
  (legacy.dinnerdata || []).slice(1).forEach(function (r) { var n = str(r[1]); if (n) mealIngredients[n.toLowerCase()] = true; });
  var itemByKey = {};
  CORE_LEGACY_LAYOUT.blocks.forEach(function (b) {
    for (var rn = CORE_LEGACY_LAYOUT.firstRow; rn <= CORE_LEGACY_LAYOUT.lastRow; rn++) {
      var name = str(cell(rn, b[1]));
      var qty = num(cell(rn, b[2]));
      if (!name || !(qty > 0)) continue;
      var pid = productId(name, 'List Builder');
      if (!pid) continue;
      var source = rn <= b[3] ? 'staple' : (b[0] === 'Dinner' && mealIngredients[name.toLowerCase()] ? 'meal' : 'added');
      var key = b[0] + '|' + pid;
      if (itemByKey[key]) { itemByKey[key].qty += qty; continue; }
      itemByKey[key] = make('trip_items', { id: coreNewId('ti'), trip_id: trip.id, product_id: pid, section_id: sectionId[b[0]], qty: qty, source: source, status: 'todo' });
    }
  });
  var checked = {};
  (legacy.shoppingList || []).slice(8).forEach(function (r) {
    var label = str(r[1]);
    if (!label) return;
    var name = label.replace(/\s*\(x\d+\)$/, '');
    if (r[0] === true) checked[name.toLowerCase()] = true;
  });
  T.trip_items.forEach(function (ti) {
    var p = productRows[ti.product_id];
    if (p && checked[p.name.toLowerCase()]) ti.status = 'in_cart';
    report.newTotal += ti.qty * (p ? p.price : 0);
  });
  report.newTotal = Math.round(report.newTotal * 100) / 100;
  (legacy.dinnerdata || []).slice(1).forEach(function (r) {
    var mid = mealByName[str(r[2]).toLowerCase()];
    if (mid) make('trip_meals', { id: coreNewId('tm'), trip_id: trip.id, meal_id: mid });
  });
  var sl = legacy.shoppingList || [];
  if (sl[4] && typeof sl[4][3] === 'number') report.legacyTotal = sl[4][3];

  // Settings
  make('settings', { id: 'tax_rate', value: '0' });
  make('settings', { id: 'budget', value: '' });
  make('settings', { id: 'meal_section_id', value: sectionId.Dinner });

  CORE_TABLES.forEach(function (t) { report.counts[t] = T[t].length; });
  return { tables: T, report: report };
}

/* Lets Node (dev server, tests) load this file; ignored by Apps Script. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CORE_SCHEMA: CORE_SCHEMA,
    CORE_TABLES: CORE_TABLES,
    coreColumns: coreColumns,
    coreColumnTypes: coreColumnTypes,
    coreFieldSpec: coreFieldSpec,
    coreCoerce: coreCoerce,
    coreNormalizeRow: coreNormalizeRow,
    coreRowFromArray: coreRowFromArray,
    coreRowToArray: coreRowToArray,
    coreNewId: coreNewId,
    coreEmptyDb: coreEmptyDb,
    coreTablesForOps: coreTablesForOps,
    coreApplyOps: coreApplyOps,
    coreTablesChangedSince: coreTablesChangedSince,
    coreChangesSince: coreChangesSince,
    coreSnapshot: coreSnapshot,
    coreMigrateLegacy: coreMigrateLegacy
  };
}
