/************** CONFIG **************/
const ROSTER_SHEET_ID = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const ROSTER_TAB_NAME = "Lanyard_Data";

const LOG_SHEET_ID    = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const LOG_TAB_NAME    = "lanyard_log";

const COUNTS_TAB_NAME = "Counts";       // auto-created if missing
const THRESHOLDS_TAB_NAME = "Thresholds";

const APP_NAME = "Lanyard";
const SCHOOL_KEY = "AVON-LANYARD-2026-SECURE";

/************** AUTH **************/
function requireKey_(provided) {
  if (String(provided || "").trim() !== String(SCHOOL_KEY).trim()) {
    throw new Error("Unauthorized");
  }
}

/************** HELPERS **************/
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(spreadsheetId, tabName) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  return sh;
}

function fmtTs_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

/************** LOG FORMAT **************/
function ensureLogHeader_(sh) {
  const desired = ["date", "student_id", "name", "grade", "team", "violations_after_reset", "parent_email"];
  if (sh.getLastRow() === 0) sh.appendRow(desired);
}

/************** COUNTS (FAST) **************/
function ensureCountsHeader_(sh) {
  const desired = ["student_id", "count", "last_updated"];
  if (sh.getLastRow() === 0) sh.appendRow(desired);
}

function getCountRow_(countsSh, studentId) {
  ensureCountsHeader_(countsSh);
  const lastRow = countsSh.getLastRow();
  if (lastRow < 2) return null;

  const finder = countsSh.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(String(studentId).trim())
    .matchEntireCell(true)
    .findNext();

  return finder ? finder.getRow() : null;
}

function incrementCount_(studentId) {
  const countsSh = getSheet_(LOG_SHEET_ID, COUNTS_TAB_NAME);
  const row = getCountRow_(countsSh, studentId);
  const ts = fmtTs_(new Date());

  if (row) {
    const current = Number(countsSh.getRange(row, 2).getValue() || 0);
    const next = current + 1;
    countsSh.getRange(row, 2).setValue(next);
    countsSh.getRange(row, 3).setValue(ts);
    return next;
  } else {
    countsSh.appendRow([String(studentId).trim(), 1, ts]);
    return 1;
  }
}

/************** ROSTER LOOKUP (FAST TextFinder) **************/
function getRosterHeaderMap_(rosterSh) {
  const headers = rosterSh.getRange(1, 1, 1, rosterSh.getLastColumn()).getValues()[0]
    .map(h => String(h).trim().toLowerCase());

  const m = {};
  headers.forEach((h, i) => m[h] = i + 1); // 1-based col
  return m;
}

function findStudentById_(studentId) {
  const rosterSh = getSheet_(ROSTER_SHEET_ID, ROSTER_TAB_NAME);
  const lastRow = rosterSh.getLastRow();
  if (lastRow < 2) return { found: false };

  const cols = getRosterHeaderMap_(rosterSh);
  const sidCol = cols["student_id"];
  if (!sidCol) throw new Error("Roster missing column: student_id");

  const target = String(studentId).trim();
  const finder = rosterSh.getRange(2, sidCol, lastRow - 1, 1)
    .createTextFinder(target)
    .matchEntireCell(true)
    .findNext();

  if (!finder) return { found: false };

  const row = finder.getRow();
  const first = cols["first_name"] ? String(rosterSh.getRange(row, cols["first_name"]).getValue() || "") : "";
  const last  = cols["last_name"]  ? String(rosterSh.getRange(row, cols["last_name"]).getValue() || "") : "";
  const grade = cols["class_year"] ? String(rosterSh.getRange(row, cols["class_year"]).getValue() || "") : "";
  const team  = cols["team"]       ? String(rosterSh.getRange(row, cols["team"]).getValue() || "") : "";
  const email = cols["parent_email"] ? String(rosterSh.getRange(row, cols["parent_email"]).getValue() || "") : "";

  const name = `${first} ${last}`.trim();

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

/************** THRESHOLDS -> TIER **************/
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

    let r = Number(row[rI] ?? 0);
    let g = Number(row[gI] ?? 0);
    let b = Number(row[bI] ?? 0);

    // If your sheet uses 0/1, scale to 0-255 automatically
    if (r <= 1 && g <= 1 && b <= 1) {
      r = Math.round(r * 255);
      g = Math.round(g * 255);
      b = Math.round(b * 255);
    }

    const label = titleI !== -1 ? String(row[titleI] ?? "") : "";
    tiers.push({ min, max, label, color: `rgb(${r},${g},${b})` });
  }

  cache.put(key, JSON.stringify(tiers), 300); // 5 minutes
  return tiers;
}

function tierForCount_(count) {
  const tiers = getThresholds_();
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
      return jsonOut({ ok: true, msg: "pong", app: APP_NAME });
    }

    if (action === "getstudent") {
      const sid = String(e?.parameter?.student_id || "").trim();
      const st = findStudentById_(sid);
      return jsonOut({ ok: true, ...st, app: APP_NAME });
    }

    return jsonOut({ ok: false, error: "Unknown action (GET)." });
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

      const logSh = getSheet_(LOG_SHEET_ID, LOG_TAB_NAME);
      ensureLogHeader_(logSh);

      const ts = fmtTs_(new Date());
      const gradeInt = st.grade === "" ? "" : Number(st.grade);

      // REQUIRED FORMAT:
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

    return jsonOut({ ok: false, error: "Unknown action (POST)." });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}
