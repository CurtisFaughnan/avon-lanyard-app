/************** CONFIG (EDIT THESE) **************/
const ROSTER_SHEET_ID = "PASTE_ROSTER_SPREADSHEET_ID_HERE";
const ROSTER_TAB_NAME = "Students"; // change if your tab name differs

const LOG_SHEET_ID    = "PASTE_THIS_MODE_LOG_SPREADSHEET_ID_HERE"; // lanyard OR tardy log sheet
const LOG_TAB_NAME    = "scan_log"; // change if your tab name differs

const APP_NAME        = "Lanyard"; // set to "Tardy" in tardy script
const EMAIL_SUBJECT   = "Student Notification";

// Simple shared secret so only your distributed app can call the API
// Change this per school (and per app: lanyard/tardy) if you want.
const SCHOOL_KEY = "CHANGE-ME-AVON-LANYARD-KEY";

function requireKey_(provided) {
  if (!SCHOOL_KEY) return; // if you leave it blank, no auth
  if (String(provided || "").trim() !== String(SCHOOL_KEY).trim()) {
    throw new Error("Unauthorized");
  }
}

/************** HELPERS **************/
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getRosterValues_() {
  const ss = SpreadsheetApp.openById(ROSTER_SHEET_ID);
  const sh = ss.getSheetByName(ROSTER_TAB_NAME);
  if (!sh) throw new Error("Roster tab not found: " + ROSTER_TAB_NAME);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { headers: [], rows: [] };
  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1);
  return { headers, rows };
}

function findStudentById_(studentId) {
  const { headers, rows } = getRosterValues_();
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
      return {
        found: true,
        student_id: target,
        first_name: idx.first_name !== -1 ? String(r[idx.first_name] ?? "") : "",
        last_name:  idx.last_name  !== -1 ? String(r[idx.last_name] ?? "") : "",
        class_year: idx.class_year !== -1 ? String(r[idx.class_year] ?? "") : "",
        team:       idx.team       !== -1 ? String(r[idx.team] ?? "") : "",
        parent_email: idx.parent_email !== -1 ? String(r[idx.parent_email] ?? "") : ""
      };
    }
  }
  return { found: false };
}

function ensureLogHeader_(sh) {
  const desired = ["timestamp", "student_id", "device", "app", "email_sent"];
  const lastRow = sh.getLastRow();
  if (lastRow === 0) {
    sh.appendRow(desired);
    return desired;
  }
  const current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
  return current;
}

function countScans_(sh, studentId) {
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return 0;
  const headers = vals[0].map(h => String(h).trim());
  const sidCol = headers.indexOf("student_id");
  if (sidCol === -1) return 0;

  let c = 0;
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][sidCol]).trim() === String(studentId).trim()) c++;
  }
  return c;
}

/************** ROUTER **************/
function doGet(e) {
  try {
    requireKey_(e && e.parameter ? e.parameter.school_key : "");
    const action = (e.parameter.action || "").toLowerCase();

    if (action === "getstudent") {
      const sid = e.parameter.student_id || "";
      const st = findStudentById_(sid);
      return jsonOut({ ok: true, ...st, app: APP_NAME });
    }

    return jsonOut({ ok: false, error: "Unknown action (GET). Use action=getStudent" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const params = e.parameter || {};
    const action = (params.action || "").toLowerCase();
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};

    requireKey_(body.school_key);

    if (action === "logscan") {
      const sid = String(body.student_id || "").trim();
      const device = String(body.device_name || "").trim();
      if (!sid) return jsonOut({ ok: false, error: "Missing student_id" });

      const st = findStudentById_(sid);
      if (!st.found) return jsonOut({ ok: true, found: false });

      const logSS = SpreadsheetApp.openById(LOG_SHEET_ID);
      const sh = logSS.getSheetByName(LOG_TAB_NAME);
      if (!sh) throw new Error("Log tab not found: " + LOG_TAB_NAME);

      ensureLogHeader_(sh);
      sh.appendRow([new Date().toISOString(), sid, device, APP_NAME, "no"]);

      const total = countScans_(sh, sid);
      return jsonOut({ ok: true, found: true, student: st, total_count: total, app: APP_NAME });
    }

    if (action === "sendemailhome") {
      const sid = String(body.student_id || "").trim();
      const total = Number(body.total_count || 0);
      const st = findStudentById_(sid);
      if (!st.found) return jsonOut({ ok: false, error: "Student not found" });
      if (!st.parent_email) return jsonOut({ ok: false, error: "No parent_email on roster" });

      const msg =
        `${APP_NAME} Notice\n\n` +
        `Student: ${st.first_name} ${st.last_name} (${st.student_id})\n` +
        `Class Year: ${st.class_year}\n` +
        `Team: ${st.team}\n\n` +
        `Total ${APP_NAME.toLowerCase()} events logged: ${total}\n\n` +
        `This is an automated message.`;

      MailApp.sendEmail(st.parent_email, EMAIL_SUBJECT, msg);

      // mark last log row for this student as emailed (optional, best-effort)
      try {
        const logSS = SpreadsheetApp.openById(LOG_SHEET_ID);
        const sh = logSS.getSheetByName(LOG_TAB_NAME);
        const vals = sh.getDataRange().getValues();
        const headers = vals[0].map(h => String(h).trim());
        const sidCol = headers.indexOf("student_id");
        const emailCol = headers.indexOf("email_sent");
        if (sidCol !== -1 && emailCol !== -1) {
          for (let i = vals.length - 1; i >= 1; i--) {
            if (String(vals[i][sidCol]).trim() === sid) {
              sh.getRange(i + 1, emailCol + 1).setValue("yes");
              break;
            }
          }
        }
      } catch (_) {}

      return jsonOut({ ok: true, sent: true });
    }

    return jsonOut({ ok: false, error: "Unknown action (POST). Use action=logScan or action=sendEmailHome" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}