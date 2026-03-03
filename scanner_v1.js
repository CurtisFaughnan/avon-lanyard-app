/************** CONFIG **************/
const ROSTER_SHEET_ID = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const ROSTER_TAB_NAME = "Lanyard_Data";

const LOG_SHEET_ID = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const LOG_TAB_NAME = "lanyard_log";

const COUNTS_TAB_NAME = "Counts";          // created if missing
const THRESHOLDS_TAB_NAME = "Thresholds";  // uses your Thresholds sheet

const APP_NAME = "Lanyard";

// Shared secret so only your distributed app can call the API
const SCHOOL_KEY = "AVON-LANYARD-2026-SECURE";

/************** AUTH **************/
function requireKey_(provided) {
  if (String(provided || "").trim() !== String(SCHOOL_KEY).trim()) {
    throw new Error("Unauthorized");
  }
}

/************** OUTPUT **************/
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/************** SHEETS **************/
function getSheet_(spreadsheetId, tabName) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  return sh;
}

function ensureLogHeader_(sh) {
  const desired = ["date", "student_id", "name", "grade", "team", "violations_after_reset", "parent_email"];
  if (sh.getLastRow() === 0) sh.appendRow(desired);
  return desired;
}

function ensureCountsHeader_(sh) {
  const desired = ["student_id", "count", "last_updated"];
  if (sh.getLastRow() === 0) sh.appendRow(desired);
  return desired;
}

/************** ROSTER CACHE + LOOKUP **************/
function rosterCacheKey_() {
  return `ROSTER_${ROSTER_SHEET_ID}_${ROSTER_TAB_NAME}`;
}

function getRosterCached_() {
  const cache = CacheService.getScriptCache();
  const key = rosterCacheKey_();
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const sh = getSheet_(ROSTER_SHEET_ID, ROSTER_TAB_NAME);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { headers: [], rows: [] };

  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1);

  const obj = { headers, rows };
  cache.put(key, JSON.stringify(obj), 300); // 5 min
  return obj;
}

function findStudentById_(studentId) {
  const { headers, rows } = getRosterCached_();

  const idx = {
    student_id: headers.indexOf("student_id"),
    first_name: headers.indexOf("first_name"),
    last_name: headers.indexOf("last_name"),
    class_year: headers.indexOf("class_year"),
    team: headers.indexOf("team"),
    parent_email: headers.indexOf("parent_email"),
  };

  if (idx.student_id === -1) throw new Error("Roster missing column: student_id");

  const target = String(studentId).trim();
  for (const r of rows) {
    if (String(r[idx.student_id]).trim() === target) {
      const first = idx.first_name !== -1 ? String(r[idx.first_name] ?? "") : "";
      const last  = idx.last_name  !== -1 ? String(r[idx.last_name] ?? "") : "";
      const grade = idx.class_year !== -1 ? String(r[idx.class_year] ?? "") : "";
      const team  = idx.team       !== -1 ? String(r[idx.team] ?? "") : "";
      const email = idx.parent_email !== -1 ? String(r[idx.parent_email] ?? "") : "";
      const name  = `${first} ${last}`.trim();

      return {
        found: true,
        student_id: target,
        first_name: first,
        last_name: last,
        name,
        grade,
        team,
        parent_email: email
      };
    }
  }
  return { found: false };
}

/************** COUNTS (VIOLATIONS AFTER RESET) **************/
function getCountRow_(countsSh, studentId) {
  ensureCountsHeader_(countsSh);

  const lastRow = countsSh.getLastRow();
  if (lastRow < 2) return { row: null, count: 0 };

  // read student_id + count only
  const values = countsSh.getRange(2, 1, lastRow - 1, 2).getValues();
  const target = String(studentId).trim();

  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === target) {
      return { row: i + 2, count: Number(values[i][1] || 0) };
    }
  }
  return { row: null, count: 0 };
}

function incrementCount_(studentId) {
  const countsSh = getSheet_(LOG_SHEET_ID, COUNTS_TAB_NAME);

  const found = getCountRow_(countsSh, studentId);
  const newCount = (found.count || 0) + 1;

  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  if (found.row) {
    countsSh.getRange(found.row, 2).setValue(newCount);
    countsSh.getRange(found.row, 3).setValue(ts);
  } else {
    countsSh.appendRow([String(studentId).trim(), newCount, ts]);
  }

  return newCount;
}

/************** THRESHOLDS -> TIER **************/
function thresholdsCacheKey_() {
  return `THRESHOLDS_${LOG_SHEET_ID}_${THRESHOLDS_TAB_NAME}`;
}

function getThresholdsCached_() {
  const cache = CacheService.getScriptCache();
  const key = thresholdsCacheKey_();
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const sh = getSheet_(LOG_SHEET_ID, THRESHOLDS_TAB_NAME);
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];

  const headers = vals[0].map(h => String(h).trim().toLowerCase());
  const minI = headers.indexOf("min");
  const maxI = headers.indexOf("max");
  const rI = headers.indexOf("r");
  const gI = headers.indexOf("g");
  const bI = headers.indexOf("b");
  const titleI = headers.indexOf("title");

  const tiers = [];
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    const min = Number(row[minI] ?? 0);
    const max = Number(row[maxI] ?? 999999);

    if (isNaN(min) || isNaN(max)) continue;

    const r = Number(row[rI] ?? 0);
    const g = Number(row[gI] ?? 0);
    const b = Number(row[bI] ?? 0);
    const title = titleI !== -1 ? String(row[titleI] ?? "") : "";

    tiers.push({
      min,
      max,
      label: title,
      color: `rgb(${r},${g},${b})`
    });
  }

  cache.put(key, JSON.stringify(tiers), 300); // 5 min
  return tiers;
}

function tierForCount_(count) {
  const tiers = getThresholdsCached_();
  for (const t of tiers) {
    if (count >= t.min && count <= t.max) return t;
  }
  return { min: 0, max: 999999, label: "", color: "" };
}

/************** ROUTES **************/
function doGet(e) {
  try {
    requireKey_(e?.parameter?.school_key);
    const action = String(e?.parameter?.action || "").toLowerCase();

    if (action === "ping") {
      return jsonOut({ ok: true, msg: "pong", key_len: String(SCHOOL_KEY).length, app: APP_NAME });
    }

    if (action === "getstudent") {
      const sid = e?.parameter?.student_id || "";
      const st = findStudentById_(sid);
      return jsonOut({ ok: true, ...st, app: APP_NAME });
    }

    return jsonOut({ ok: false, error: "Unknown action (GET). Use action=ping or action=getStudent" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const action = String(e?.parameter?.action || "").toLowerCase();
    const body = e?.postData?.contents ? JSON.parse(e.postData.contents) : {};

    requireKey_(body.school_key);

    if (action === "logscan") {
      const sid = String(body.student_id || "").trim();
      const device = String(body.device_name || "").trim(); // kept for future, not stored in log format
      if (!sid) return jsonOut({ ok: false, error: "Missing student_id" });

      const st = findStudentById_(sid);
      if (!st.found) return jsonOut({ ok: true, found: false });

      // increment "violations after reset"
      const newCount = incrementCount_(sid);
      const tier = tierForCount_(newCount);

      // append log row in your required format
      const logSh = getSheet_(LOG_SHEET_ID, LOG_TAB_NAME);
      ensureLogHeader_(logSh);

      const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      const gradeInt = st.grade === "" ? "" : Number(st.grade);

      logSh.appendRow([
        ts,
        sid,
        st.name,
        gradeInt,
        st.team,
        newCount,
        st.parent_email
      ]);

      return jsonOut({
        ok: true,
        found: true,
        student: st,
        total_count: newCount,
        tier,
        app: APP_NAME
      });
    }

    return jsonOut({ ok: false, error: "Unknown action (POST). Use action=logScan" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/************** OPTIONAL: RUN ONCE IN SCRIPT EDITOR TO AUTHORIZE **************/
function testAccess() {
  const ss = SpreadsheetApp.openById(ROSTER_SHEET_ID);
  Logger.log("Access OK. Sheet name: " + ss.getName());
}
