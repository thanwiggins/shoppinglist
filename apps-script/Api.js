/**
 * Aisle web-app API. Deployed as a web app ("Execute as: Me", "Who has access: Anyone").
 * Every request is a POST with a text/plain JSON body (text/plain avoids the browser's
 * CORS pre-flight, which Apps Script can't answer):
 *
 *   { key, action: 'bootstrap' }                    → { ok, version, tables }
 *   { key, action: 'sync', since, ops: [...] }      → { ok, version, changes }
 *
 * `sync` applies the ops (if any) and returns every row changed after `since`,
 * so one round trip both pushes and pulls.
 */

function doGet() {
  return api_json_({ ok: true, app: 'aisle', message: 'Aisle API is running. Use POST.' });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    api_checkKey_(body.key);
    if (body.action === 'bootstrap') return api_json_(api_bootstrap_());
    if (body.action === 'sync') return api_json_(api_sync_(Number(body.since) || 0, body.ops || [], String(body.epoch || '')));
    if (body.action === 'ping') return api_json_({ ok: true });
    throw coreError('bad_request', 'Unknown action: ' + body.action);
  } catch (err) {
    return api_json_({ ok: false, code: err.code || 'error', error: String((err && err.message) || err) });
  }
}

function api_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function api_checkKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('AISLE_API_KEY');
  if (!expected) throw coreError('not_configured', 'The API key has not been set up yet.');
  if (!key || String(key) !== expected) throw coreError('unauthorized', 'Wrong access key.');
}

function api_bootstrap_() {
  var ss = db_spreadsheet_();
  var db = db_load_(ss, CORE_TABLES);
  return { ok: true, version: db.version, epoch: db.epoch, tables: coreSnapshot(db) };
}

function api_sync_(since, ops, epoch) {
  if (ops.length > 2000) throw coreError('bad_request', 'Too many changes in one batch.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = db_spreadsheet_();
    var db = db_getMeta_();
    // The device knows a newer version than the server has (the data was re-migrated):
    // tell it to download everything again instead of applying anything.
    // Also covers a device that connected before the first copy (its epoch is still empty).
    if (since > db.version || epoch !== (db.epoch || '')) {
      return { ok: true, reset: true, version: db.version, epoch: db.epoch, changes: {} };
    }
    var need = {};
    coreTablesForOps(ops).forEach(function (t) { need[t] = true; });
    coreTablesChangedSince(db, since).forEach(function (t) { need[t] = true; });
    Object.keys(need).forEach(function (t) { db.tables[t] = db_readTable_(ss, t); });

    var touched = coreApplyOps(db, ops, new Date().toISOString());
    if (touched.length) {
      touched.forEach(function (t) { db_writeTable_(ss, t, db.tables[t]); });
      db_setMeta_(db);
    }
    return { ok: true, version: db.version, epoch: db.epoch, changes: coreChangesSince(db, since) };
  } finally {
    lock.releaseLock();
  }
}
