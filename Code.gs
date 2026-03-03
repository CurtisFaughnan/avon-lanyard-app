/************** CONFIG **************/
const ROSTER_SHEET_ID = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const ROSTER_TAB_NAME = "Lanyard_Data";

const LOG_SHEET_ID = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const LOG_TAB_NAME = "lanyard_log";

const COUNTS_TAB_NAME = "Counts";
const THRESHOLDS_TAB_NAME = "Thresholds";

const APP_NAME = "Lanyard";
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

/************** SHEET HELPERS **************/
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

/************** FAST ROSTER LOOKUP (TextFinder) **************/
function findStudentById_(studentId) {
  const sid = String(studentId || "").trim();
  if (!sid) return { found: false };

  const sh = getSheet_(ROSTER_SHEET_ID, ROSTER_TAB_NAME);

  // Assumes roster columns:
  // A student_id, B first_name, C last_name, D class_year, E team, F parent_email
  // Find in column A only (skip header row)
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { found: false };

  const colA = sh.getRange(2, 1, lastRow - 1, 1);
  const match = colA.createTextFinder(sid).matchEntireCell(true).findNext();
  if (!match) return { found: false };

  const row = match.getRow();
  const vals = sh.getRange(row, 1, 1, 6).getValues()[0];

  const first = String(vals[1] ?? "").trim();
  const last  = String(vals[2] ?? "").trim();
  const grade = String(vals[3] ?? "").trim();
  const team  = String(vals[4] ?? "").trim();
  const email = String(vals[5] ?? "").trim();

  return {
    found: true,
    student_id: sid,
    first_name: first,
    last_name: last,
    class_year: grade,
    team: team,
    parent_email: email,
    name: `${first} ${last}`.trim(),
    grade: grade
  };
}

/************** COUNTS (after reset) **************/
function incrementCount_(studentId) {
  const sid = String(studentId || "").trim();
  const countsSh = getSheet_(LOG_SHEET_ID, COUNTS_TAB_NAME);
  ensureCountsHeader_(countsSh);

  const lastRow = countsSh.getLastRow();
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  // If empty, append first
  if (lastRow < 2) {
    countsSh.appendRow([sid, 1, ts]);
    return 1;
  }

  // Search student_id in column A (starting row 2)
  const colA = countsSh.getRange(2, 1, lastRow - 1, 1);
  const match = colA.createTextFinder(sid).matchEntireCell(true).findNext();

  if (!match) {
    countsSh.appendRow([sid, 1, ts]);
    return 1;
  }

  const row = match.getRow();
  const current = Number(countsSh.getRange(row, 2).getValue() || 0);
  const next = current + 1;

  countsSh.getRange(row, 2).setValue(next);
  countsSh.getRange(row, 3).setValue(ts);

  return next;
}

/************** THRESHOLDS **************/
function getThresholds_() {
  const cache = CacheService.getScriptCache();
  const key = `THRESH_${LOG_SHEET_ID}_${THRESHOLDS_TAB_NAME}`;
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
    const r = Number(row[rI] ?? 0);
    const g = Number(row[gI] ?? 0);
    const b = Number(row[bI] ?? 0);
    const title = titleI !== -1 ? String(row[titleI] ?? "").trim() : "";

    tiers.push({
      min, max,
      label: title,
      color: `rgb(${r},${g},${b})`
    });
  }

  cache.put(key, JSON.stringify(tiers), 300);
  return tiers;
}

function tierForCount_(count) {
  const tiers = getThresholds_();
  for (const t of tiers) {
    if (count >= t.min && count <= t.max) return t;
  }
  return { label: "", color: "" };
}

/************** ROUTES **************/
function doGet(e) {
  try {
    requireKey_(e?.parameter?.school_key);
    const action = String(e?.parameter?.action || "").toLowerCase();

    if (action === "ping") {
      return jsonOut({ ok: true, msg: "pong", app: APP_NAME });
    }

    if (action === "getstudent") {
      const sid = e.parameter.student_id || "";
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
      const device = String(body.device_name || "").trim(); // kept for future, not logged in your format
      if (!sid) return jsonOut({ ok: false, error: "Missing student_id" });

      const st = findStudentById_(sid);
      if (!st.found) return jsonOut({ ok: true, found: false });

      const newCount = incrementCount_(sid);
      const tier = tierForCount_(newCount);

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
        tier: tier,
        app: APP_NAME
      });
    }

    return jsonOut({ ok: false, error: "Unknown action (POST). Use action=logScan" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/************** MANUAL TEST (Run once if needed) **************/
function testAccess() {
  const ss = SpreadsheetApp.openById(ROSTER_SHEET_ID);
  Logger.log("Access OK. Sheet name: " + ss.getName());
}
