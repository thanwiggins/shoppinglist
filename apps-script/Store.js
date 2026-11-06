/**
 * Sheet storage for the Aisle app. Each table lives in its own tab named
 * "db_<table>" with a header row; values only, no formulas.
 */

var DB_PREFIX = 'db_';
var DB_META_KEY = 'AISLE_DB_META';

function db_spreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw coreError('not_configured', 'Spreadsheet not found. Open the spreadsheet and choose Aisle → Link New Device.');
  return SpreadsheetApp.openById(id);
}

/** Returns the tab for a table, creating it (with header + column formats) if needed. */
function db_sheet_(ss, table) {
  var name = DB_PREFIX + table;
  var sheet = ss.getSheetByName(name);
  var cols = coreColumns(table);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    db_formatColumns_(sheet, table);
  }
  return sheet;
}

/** Text columns are formatted as plain text so Sheets never turns "2026-11-06" or "1/2" into dates. */
function db_formatColumns_(sheet, table) {
  var types = coreColumnTypes(table);
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  coreColumns(table).forEach(function (c, i) {
    if (types[c] === 'string') sheet.getRange(2, i + 1, rows, 1).setNumberFormat('@');
  });
}

function db_readTable_(ss, table) {
  var sheet = db_sheet_(ss, table);
  var last = sheet.getLastRow();
  var out = {};
  if (last < 2) return out;
  var cols = coreColumns(table).length;
  var values = sheet.getRange(2, 1, last - 1, cols).getValues();
  values.forEach(function (arr) {
    if (!arr[0]) return;
    var row = coreRowFromArray(table, arr);
    out[row.id] = row;
  });
  return out;
}

function db_writeTable_(ss, table, rowsById) {
  var sheet = db_sheet_(ss, table);
  var cols = coreColumns(table).length;
  var ids = Object.keys(rowsById);
  var existingRows = Math.max(sheet.getLastRow() - 1, 0);
  if (ids.length + 1 > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), ids.length + 1 - sheet.getMaxRows() + 50);
    db_formatColumns_(sheet, table);
  }
  if (ids.length) {
    var values = ids.map(function (id) { return coreRowToArray(table, rowsById[id]); });
    sheet.getRange(2, 1, values.length, cols).setValues(values);
  }
  if (existingRows > ids.length) {
    sheet.getRange(ids.length + 2, 1, existingRows - ids.length, cols).clearContent();
  }
}

function db_getMeta_() {
  var raw = PropertiesService.getScriptProperties().getProperty(DB_META_KEY);
  var meta = coreEmptyDb();
  if (raw) {
    var saved = JSON.parse(raw);
    meta.version = saved.version || 0;
    meta.epoch = saved.epoch || '';
    CORE_TABLES.forEach(function (t) { meta.tableVersions[t] = (saved.tableVersions || {})[t] || 0; });
  }
  return meta;
}

function db_setMeta_(db) {
  PropertiesService.getScriptProperties().setProperty(DB_META_KEY, JSON.stringify({
    version: db.version,
    epoch: db.epoch,
    tableVersions: db.tableVersions
  }));
}

/** Loads the meta plus the named tables into a core db object. */
function db_load_(ss, tables) {
  var db = db_getMeta_();
  tables.forEach(function (t) { db.tables[t] = db_readTable_(ss, t); });
  return db;
}
