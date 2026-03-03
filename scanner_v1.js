// ✅ IMPORTANT: use +esm so there are NO bare imports like "@zxing/library"
import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";

const cfg = window.APP_CONFIG;

/************ ELEMENTS ************/
const titleEl = document.getElementById("title");
const studentIdEl = document.getElementById("studentId");
const lookupBtn = document.getElementById("lookupBtn");
const scanBtn = document.getElementById("scanBtn");
// (Email removed as requested)
const emailBtn = document.getElementById("emailBtn");

const nameEl = document.getElementById("name");
const yearEl = document.getElementById("year");
const teamEl = document.getElementById("team");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");

const scannerWrap = document.getElementById("scanner");
const videoEl = document.getElementById("video");
const closeBtn = document.getElementById("closeScan");

/************ INIT ************/
if (titleEl) titleEl.textContent = cfg?.appLabel || "Scanner App";
if (statusEl) statusEl.textContent = "Ready.";

// hide email button if it exists in HTML
if (emailBtn) emailBtn.style.display = "none";

/************ HELPERS ************/
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

async function apiGet(action, params) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("school_key", cfg.schoolKey);

  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { method: "GET" });
  return await res.json();
}

async function apiPost(action, body) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);

  const payload = { ...(body || {}), school_key: cfg.schoolKey };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  return await res.json();
}

/************ LOOKUP + LOG ************/
async function lookupAndLog() {
  try {
    const sid = (studentIdEl?.value || "").trim();
    if (!sid) return setStatus("Enter a student ID.");

    setStatus("Looking up...");

    const student = await apiGet("getStudent", { student_id: sid });
    if (!student.ok) return setStatus("Lookup error: " + (student.error || "unknown"));

    if (!student.found) {
      if (nameEl) nameEl.textContent = "-";
      if (yearEl) yearEl.textContent = "-";
      if (teamEl) teamEl.textContent = "-";
      if (countEl) countEl.textContent = "-";
      return setStatus("Student not found.");
    }

    if (nameEl) nameEl.textContent = `${student.first_name} ${student.last_name}`;
    if (yearEl) yearEl.textContent = student.class_year || "-";
    if (teamEl) teamEl.textContent = student.team || "-";

    setStatus("Logging...");

    const logRes = await apiPost("logScan", {
      student_id: sid,
      device_name: navigator.userAgent,
      ts: new Date().toISOString(),
    });

    if (!logRes.ok) return setStatus("Log error: " + (logRes.error || "unknown"));
    if (!logRes.found) return setStatus("Not logged (student not found).");

    if (countEl) countEl.textContent = String(logRes.total_count ?? "-");
    setStatus("Logged.");
  } catch (err) {
    setStatus("App error: " + String(err));
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
    if (!scannerWrap || !videoEl) return setStatus("Camera UI not found in HTML.");

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
    setStatus("Camera error: " + String(err));
    stopCamera();
  }
}

function stopCamera() {
  try {
    if (stopScan) stopScan();
  } catch (_) {}
  stopScan = null;
  if (scannerWrap) scannerWrap.style.display = "none";
}

scanBtn?.addEventListener("click", startCamera);
closeBtn?.addEventListener("click", stopCamera);
