/************** CONFIG **************/
const ROSTER_SHEET_ID = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const ROSTER_TAB_NAME = "Lanyard_Data";

const LOG_SHEET_ID = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const LOG_TAB_NAME = "lanyard_log";

const COUNTS_TAB_NAME = "Counts";          // stores count since reset per student
const THRESHOLDS_TAB_NAME = "Thresholds";  // min,max,r,g,b,title

const APP_NAME = "Lanyard";

// Shared secret so only your distributed app can call the API
const SCHOOL_KEY = "AVON-LANYARD-2026-SECURE";

/************** AUTH **************/
function requireKey_(provided) {
  if (String(provided || "").trim() !== String(SCHOOL_KEY).trim()) {
    throw new Error("Unauthorized");
  }
}

/************** UTIL **************/
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function fmtTs_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function getSheet_(spreadsheetId, tabName) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  return sh;
}

function ensureHeader_(sh, desiredHeaders) {
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), desiredHeaders.length);

  if (lastRow === 0) {
    sh.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);
    return;
  }

  // Force header to match exactly (keeps your format consistent)
  sh.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);

  // If there are extra old columns, we leave them alone but your app writes only your format.
  if (lastCol > desiredHeaders.length) {
    // optional: you could clear old header cells beyond desired headers
  }
}

/************** ROSTER CACHE **************/
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
  if (values.length < 2) {
    const empty = { headers: [], rows: [] };
    cache.put(key, JSON.stringify(empty), 300);
    return empty;
  }

  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1);

  const obj = { headers, rows };
  cache.put(key, JSON.stringify(obj), 300); // 5 minutes
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
      const name = `${first} ${last}`.trim();

      return {
        found: true,
        student_id: target,
        name,
        grade: grade === "" ? "" : Number(grade),
        team,
        parent_email: email,
        // keep these for compatibility if you still display them:
        first_name: first,
        last_name: last,
        class_year: grade
      };
    }
  }

  return { found: false };
}

/************** COUNTS (FAST) **************/
function ensureCounts_() {
  const sh = getSheet_(LOG_SHEET_ID, COUNTS_TAB_NAME);
  ensureHeader_(sh, ["student_id", "count", "last_updated"]);
  return sh;
}

function incrementCount_(studentId) {
  const sh = ensureCounts_();
  const target = String(studentId).trim();

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    sh.appendRow([target, 1, fmtTs_(new Date())]);
    return 1;
  }

  // Read only columns A+B for existing students
  const data = sh.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === target) {
      const row = i + 2;
      const next = Number(data[i][1] || 0) + 1;
      sh.getRange(row, 2).setValue(next);
      sh.getRange(row, 3).setValue(fmtTs_(new Date()));
      return next;
    }
  }

  sh.appendRow([target, 1, fmtTs_(new Date())]);
  return 1;
}

/************** THRESHOLDS + TIER **************/
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
  if (vals.length < 2) {
    const empty = [];
    cache.put(key, JSON.stringify(empty), 300);
    return empty;
  }

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
    const r = Number(row[rI] ?? 0);
    const g = Number(row[gI] ?? 0);
    const b = Number(row[bI] ?? 0);
    const label = titleI !== -1 ? String(row[titleI] ?? "") : "";
    tiers.push({ min, max, label, color: `rgb(${r},${g},${b})` });
  }

  cache.put(key, JSON.stringify(tiers), 300);
  return tiers;
}

function tierForCount_(count) {
  const tiers = getThresholdsCached_();
  for (const t of tiers) {
    if (count >= t.min && count <= t.max) return t;
  }
  return { min: 0, max: 999999, label: "", color: "rgb(255,255,255)" };
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
      const sid = String(e?.parameter?.student_id || "").trim();
      const st = findStudentById_(sid);
      return jsonOut({ ok: true, ...st, app: APP_NAME });
    }

    return jsonOut({ ok: false, error: "Unknown action (GET). Use action=ping or action=getStudent" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const action = String(e?.parameter?.action || "").toLowerCase();
    const body = e?.postData?.contents ? JSON.parse(e.postData.contents) : {};

    requireKey_(body.school_key);

    if (action === "logscan") {
      const sid = String(body.student_id || "").trim();
      if (!sid) return jsonOut({ ok: false, error: "Missing student_id" });

      const st = findStudentById_(sid);
      if (!st.found) return jsonOut({ ok: true, found: false, app: APP_NAME });

      const newCount = incrementCount_(sid);
      const tier = tierForCount_(newCount);

      // Write log row in REQUIRED FORMAT
      const logSh = getSheet_(LOG_SHEET_ID, LOG_TAB_NAME);
      ensureHeader_(logSh, ["date", "student_id", "name", "grade", "team", "violations_after_reset", "parent_email"]);

      const ts = fmtTs_(new Date());
      logSh.appendRow([ts, sid, st.name, st.grade, st.team, newCount, st.parent_email]);

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
  }
}

/************** OPTIONAL: run once in Apps Script editor if you ever get permissions issues **************/
function testAccess() {
  const ss = SpreadsheetApp.openById(ROSTER_SHEET_ID);
  Logger.log("Access OK: " + ss.getName());
}
