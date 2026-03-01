import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/esm/index.min.js";

const cfg = window.APP_CONFIG;

/************ ELEMENTS ************/
const titleEl = document.getElementById("title");
const studentIdEl = document.getElementById("studentId");
const lookupBtn = document.getElementById("lookupBtn");
const scanBtn = document.getElementById("scanBtn");
const emailBtn = document.getElementById("emailBtn");

const nameEl = document.getElementById("name");
const yearEl = document.getElementById("year");
const teamEl = document.getElementById("team");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");

const scannerWrap = document.getElementById("scanner");
const videoEl = document.getElementById("video");
const closeBtn = document.getElementById("closeScan");

titleEl.textContent = cfg?.appLabel || "Scanner App";

/************ HELPERS ************/
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

async function apiGet(action, params) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("school_key", cfg.schoolKey);

  Object.entries(params || {}).forEach(([k, v]) =>
    url.searchParams.set(k, v)
  );

  const res = await fetch(url.toString());
  return await res.json();
}

async function apiPost(action, body) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);

  const payload = {
    ...(body || {}),
    school_key: cfg.schoolKey
  };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  return await res.json();
}

/************ LOOKUP + LOG ************/
async function lookupAndLog() {
  try {
    const sid = studentIdEl.value.trim();
    if (!sid) {
      setStatus("Enter a student ID.");
      return;
    }

    emailBtn.style.display = "none";
    setStatus("Looking up...");

    const student = await apiGet("getStudent", { student_id: sid });

    if (!student.ok) {
      setStatus("Lookup error: " + (student.error || "unknown"));
      return;
    }

    if (!student.found) {
      setStatus("Student not found.");
      nameEl.textContent = "-";
      yearEl.textContent = "-";
      teamEl.textContent = "-";
      countEl.textContent = "-";
      return;
    }

    nameEl.textContent = `${student.first_name} ${student.last_name}`;
    yearEl.textContent = student.class_year || "-";
    teamEl.textContent = student.team || "-";

    setStatus("Logging...");

    const logRes = await apiPost("logScan", {
      student_id: sid,
      device_name: navigator.userAgent,
      ts: new Date().toISOString()
    });

    if (!logRes.ok) {
      setStatus("Log error: " + (logRes.error || "unknown"));
      return;
    }

    countEl.textContent = logRes.total_count;
    setStatus("Logged.");

    emailBtn.style.display = "inline-block";
    emailBtn.onclick = async () => {
      setStatus("Sending email...");
      const emailRes = await apiPost("sendEmailHome", {
        student_id: sid,
        total_count: logRes.total_count
      });

      if (emailRes.ok) {
        setStatus("Email sent.");
      } else {
        setStatus("Email failed.");
      }
    };

  } catch (err) {
    setStatus("App error: " + err.message);
  }
}

/************ BUTTON EVENTS ************/
lookupBtn?.addEventListener("click", lookupAndLog);

studentIdEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") lookupAndLog();
});

/************ CAMERA ************/
let stopScan = null;

async function startCamera() {
  try {
    scannerWrap.style.display = "block";
    setStatus("Opening camera...");

    const reader = new BrowserMultiFormatReader();

    const controls = await reader.decodeFromConstraints(
      { video: { facingMode: "environment" } },
      videoEl,
      (result) => {
        if (result) {
          studentIdEl.value = result.getText();
          stopCamera();
          lookupAndLog();
        }
      }
    );

    stopScan = () => controls.stop();
    setStatus("Scanning...");
  } catch (err) {
    setStatus("Camera error: " + err.message);
    stopCamera();
  }
}

function stopCamera() {
  if (stopScan) stopScan();
  stopScan = null;
  scannerWrap.style.display = "none";
}

scanBtn?.addEventListener("click", startCamera);
closeBtn?.addEventListener("click", stopCamera);
