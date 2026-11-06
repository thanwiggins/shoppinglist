/**
 * One-time setup for the Aisle app, run from the spreadsheet's "Aisle app" menu.
 */

function aisleAddMenu_(ui) {
  ui.createMenu('Aisle app')
    .addItem('1. Copy data into the app tables', 'aisleMigrate')
    .addItem('2. Show access key', 'aisleShowKey')
    .addSeparator()
    .addItem('Make a new access key', 'aisleRotateKey')
    .addToUi();
}

function aisleShowKey() {
  var key = aisleEnsureKey_();
  SpreadsheetApp.getUi().alert(
    'Aisle access key',
    'Enter this key in the app the first time you open it on each device:\n\n' + key +
    '\n\nKeep it private: anyone with the key and the app address can read and change your lists.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function aisleRotateKey() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Make a new access key?', 'Every device will need the new key to keep syncing.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().deleteProperty('AISLE_API_KEY');
  aisleShowKey();
}

function aisleEnsureKey_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('AISLE_API_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('AISLE_API_KEY', key);
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) props.setProperty('SPREADSHEET_ID', ss.getId());
  return key;
}

/**
 * Copies the original tabs (Products, Departments, Meals, List Builder,
 * Shopping List, Dinnerdata) into new db_* tabs. The original tabs are not changed.
 */
function aisleMigrate() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var existing = ss.getSheetByName(DB_PREFIX + 'products');
  if (existing && existing.getLastRow() > 1) {
    var again = ui.alert(
      'App tables already exist',
      'Copying again replaces everything in the db_ tabs (including changes made in the app) ' +
      'with a fresh copy of the original tabs. Continue?',
      ui.ButtonSet.OK_CANCEL
    );
    if (again !== ui.Button.OK) return;
  }

  var tz = ss.getSpreadsheetTimeZone();
  var values = function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Missing tab: ' + name);
    return sheet.getDataRange().getValues().map(function (row) {
      return row.map(function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; });
    });
  };
  var legacy = {
    products: values('Products'),
    departments: values('Departments'),
    meals: values('Meals'),
    listBuilder: values('List Builder'),
    shoppingList: values('Shopping List'),
    dinnerdata: values('Dinnerdata')
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var result = coreMigrateLegacy(legacy, new Date().toISOString());
    var db = db_getMeta_();
    var version = db.version + 1;
    CORE_TABLES.forEach(function (t) {
      var byId = {};
      result.tables[t].forEach(function (row) { row._v = version; byId[row.id] = row; });
      var sheet = db_sheet_(ss, t);
      if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
      db_writeTable_(ss, t, byId);
      db.tableVersions[t] = version;
    });
    db.version = version;
    db.epoch = Utilities.getUuid();
    db_setMeta_(db);
    var key = aisleEnsureKey_();
    var r = result.report;
    ui.alert(
      'Copied into the app tables',
      'Products: ' + r.counts.products + '   Meals: ' + r.counts.meals + '   Staples: ' + r.counts.staples +
      '\nPurchase history rows: ' + r.counts.purchases +
      '\nThis week\'s list: ' + r.counts.trip_items + ' items, estimated $' + r.newTotal.toFixed(2) +
      (r.legacyTotal !== null ? ' (Shopping List says $' + Number(r.legacyTotal).toFixed(2) + ')' : '') +
      (r.duplicatesMerged.length ? '\n\nMerged duplicate products: ' + r.duplicatesMerged.join(', ') : '') +
      (r.unknownNames.length ? '\n\nNames that matched no product (skipped): ' + r.unknownNames.join(', ') : '') +
      '\n\nAccess key for the app:\n' + key,
      ui.ButtonSet.OK
    );
  } finally {
    lock.releaseLock();
  }
}
