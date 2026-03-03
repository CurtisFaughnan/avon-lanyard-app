/************** CONFIG **************/
const ROSTER_SHEET_ID = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const ROSTER_TAB_NAME = "Lanyard_Data";

const LOG_SHEET_ID = "1RnnPmQITQtevn04cMKw_PMflLr7jbAeDJ3PfXZaBDwE";
const LOG_TAB_NAME = "lanyard_log";

const COUNTS_TAB_NAME = "Counts"; // created automatically
const THRESHOLDS_TAB_NAME = "Thresholds"; // must exist

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
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function ts_() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

// Cache opens within a single execution (big speed win)
const _ssCache_ = {};
function openSs_(spreadsheetId) {
  if (!_ssCache_[spreadsheetId]) {
    _ssCache_[spreadsheetId] = SpreadsheetApp.openById(spreadsheetId);
  }
  return _ssCache_[spreadsheetId];
}

function getSheet_(spreadsheetId, tabName) {
  const ss = openSs_(spreadsheetId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  return sh;
}

function ensureLogHeader_(sh) {
  const desired = [
    "date",
    "student_id",
    "name",
    "grade",
    "team",
    "violations_after_reset",
    "parent_email",
  ];
  if (sh.getLastRow() === 0) sh.appendRow(desired);
  return desired;
}

function ensureCountsHeader_(sh) {
  const desired = ["student_id", "count", "last_updated"];
  if (sh.getLastRow() === 0) sh.appendRow(desired);
  return desired;
}

/************** ROSTER LOOKUP (FAST: TextFinder) **************/
function getRosterMeta_() {
  const cache = CacheService.getScriptCache();
  const key = `ROSTER_META_${ROSTER_SHEET_ID}_${ROSTER_TAB_NAME}`;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const sh = getSheet_(ROSTER_SHEET_ID, ROSTER_TAB_NAME);
  const lastCol = sh.getLastColumn();
  const header = sh
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map((h) => String(h).trim());

  const meta = {
    lastCol,
    idx: {
      student_id: header.indexOf("student_id"),
      first_name: header.indexOf("first_name"),
      last_name: header.indexOf("last_name"),
      class_year: header.indexOf("class_year"),
      team: header.indexOf("team"),
      parent_email: header.indexOf("parent_email"),
    },
  };

  if (meta.idx.student_id === -1)
    throw new Error("Roster missing column header: student_id");

  cache.put(key, JSON.stringify(meta), 6 * 60 * 60); // 6 hours
  return meta;
}

function findStudentById_(studentId) {
  const sid = String(studentId || "").trim();
  if (!sid) return { found: false };

  const sh = getSheet_(ROSTER_SHEET_ID, ROSTER_TAB_NAME);
  const meta = getRosterMeta_();

  const sidCol = meta.idx.student_id + 1;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { found: false };

  // Search only the student_id column (rows 2..lastRow)
  const range = sh.getRange(2, sidCol, lastRow - 1, 1);
  const finder = range.createTextFinder(sid).matchEntireCell(true);
  const cell = finder.findNext();

  if (!cell) return { found: false };

  const rowNum = cell.getRow();
  const row = sh.getRange(rowNum, 1, 1, meta.lastCol).getValues()[0];
  const i = meta.idx;

  const first = i.first_name !== -1 ? String(row[i.first_name] ?? "") : "";
  const last = i.last_name !== -1 ? String(row[i.last_name] ?? "") : "";
  const grade = i.class_year !== -1 ? String(row[i.class_year] ?? "") : "";
  const team = i.team !== -1 ? String(row[i.team] ?? "") : "";
  const email = i.parent_email !== -1 ? String(row[i.parent_email] ?? "") : "";

  return {
    found: true,
    student_id: sid,
    first_name: first,
    last_name: last,
    name: `${first} ${last}`.trim(),
    grade: grade,
    team: team,
    parent_email: email,
  };
}

/************** COUNTS (FASTER: TextFinder instead of scanning all rows) **************/
function getCountRow_(countsSh, sid) {
  ensureCountsHeader_(countsSh);

  const lastRow = countsSh.getLastRow();
  if (lastRow < 2) return { row: null, count: 0 };

  const target = String(sid).trim();
  const range = countsSh.getRange(2, 1, lastRow - 1, 1); // student_id column only
  const finder = range.createTextFinder(target).matchEntireCell(true);
  const cell = finder.findNext();

  if (!cell) return { row: null, count: 0 };

  const rowNum = cell.getRow();
  const countVal = Number(countsSh.getRange(rowNum, 2).getValue() || 0);
  return { row: rowNum, count: countVal };
}

function incrementCount_(sid) {
  const sh = getSheet_(LOG_SHEET_ID, COUNTS_TAB_NAME);
  const found = getCountRow_(sh, sid);

  const newCount = (found.count || 0) + 1;
  const stamp = ts_();

  if (found.row) {
    sh.getRange(found.row, 2).setValue(newCount);
    sh.getRange(found.row, 3).setValue(stamp);
  } else {
    sh.appendRow([String(sid).trim(), newCount, stamp]);
  }

  return newCount;
}

/************** THRESHOLDS -> TIER **************/
function getThresholds_() {
  const cache = CacheService.getScriptCache();
  const key = `THRESH_${LOG_SHEET_ID}_${THRESHOLDS_TAB_NAME}`;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const sh = getSheet_(LOG_SHEET_ID, THRESHOLDS_TAB_NAME);
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];

  const headers = vals[0].map((h) => String(h).trim().toLowerCase());
  const minI = headers.indexOf("min");
  const maxI = headers.indexOf("max");
  const rI = headers.indexOf("r");
  const gI = headers.indexOf("g");
  const bI = headers.indexOf("b");
  const titleI = headers.indexOf("title");

  const tiers = [];
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    if (row.join("").trim() === "") continue;

    const min = Number(row[minI] ?? 0);
    const max = Number(row[maxI] ?? 999999);
    const r = Number(row[rI] ?? 0);
    const g = Number(row[gI] ?? 0);
    const b = Number(row[bI] ?? 0);
    const title = titleI !== -1 ? String(row[titleI] ?? "") : "";

    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;

    tiers.push({ min, max, label: title, color: `rgb(${r},${g},${b})` });
  }

  cache.put(key, JSON.stringify(tiers), 300); // 5 minutes
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
      return jsonOut({
        ok: true,
        msg: "pong",
        key_len: String(SCHOOL_KEY).length,
        app: APP_NAME,
      });
    }

    if (action === "getstudent") {
      const sid = e.parameter.student_id || "";
      const st = findStudentById_(sid);
      return jsonOut({ ok: true, ...st, app: APP_NAME });
    }

    return jsonOut({ ok: false, error: "Unknown action (GET)" });
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
      if (!st.found) return jsonOut({ ok: true, found: false });

      const newCount = incrementCount_(sid);
      const tier = tierForCount_(newCount);

      const logSh = getSheet_(LOG_SHEET_ID, LOG_TAB_NAME);
      ensureLogHeader_(logSh);

      logSh.appendRow([
        ts_(),
        sid,
        st.name,
        st.grade === "" ? "" : Number(st.grade),
        st.team,
        newCount,
        st.parent_email,
      ]);

      // ✅ IMPORTANT: student returned here so frontend can skip getStudent call
      return jsonOut({
        ok: true,
        found: true,
        student: st,
        total_count: newCount,
        tier,
        app: APP_NAME,
      });
    }

    return jsonOut({ ok: false, error: "Unknown action (POST)" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}
