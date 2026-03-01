import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/esm/index.min.js";

const cfg = window.APP_CONFIG;

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

titleEl.textContent = cfg.appLabel;

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function apiGet(action, params) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);
  if (cfg.schoolKey) url.searchParams.set("school_key", cfg.schoolKey);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: "GET" });
  return await res.json();
}

async function apiPost(action, body) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ school_key: cfg.schoolKey, ...(body || {}) })
  });
  return await res.json();
}

async function lookupAndLog() {
  const sid = studentIdEl.value.trim();
  if (!sid) return;

  emailBtn.style.display = "none";
  setStatus("Looking up...");

  const s = await apiGet("getStudent", { student_id: sid });

  if (!s.ok) {
    setStatus(`Error: ${s.error || "unknown error"}`);
    return;
  }

  if (!s.found) {
    nameEl.textContent = "-";
    yearEl.textContent = "-";
    teamEl.textContent = "-";
    countEl.textContent = "-";
    setStatus("Student not found.");
    return;
  }

  nameEl.textContent = `${s.first_name} ${s.last_name}`;
  yearEl.textContent = s.class_year || "";
  teamEl.textContent = s.team || "";

  setStatus("Logging...");
  const r = await apiPost("logScan", {
    student_id: sid,
    device_name: navigator.userAgent,
    ts: new Date().toISOString()
  });

  if (!r.ok) {
    setStatus(`Error: ${r.error || "unknown error"}`);
    return;
  }

  if (!r.found) {
    setStatus("Student not found (log).");
    return;
  }

  countEl.textContent = String(r.total_count);
  setStatus("Logged.");

  // show Email Home button
  emailBtn.style.display = "inline-block";
  emailBtn.onclick = async () => {
    emailBtn.disabled = true;
    setStatus("Sending email...");
    const e = await apiPost("sendEmailHome", {
      student_id: sid,
      total_count: r.total_count
    });
    setStatus(e.ok ? "Email sent." : `Email failed: ${e.error || "unknown error"}`);
    emailBtn.disabled = false;
  };
}

// USB scanner usually ends with Enter:
studentIdEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") lookupAndLog();
});
lookupBtn.addEventListener("click", lookupAndLog);

/******** Camera scanning ********/
let stopFn = null;

async function startCamera() {
  scannerWrap.style.display = "block";
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

  stopFn = () => controls.stop();
}

function stopCamera() {
  if (stopFn) stopFn();
  stopFn = null;
  scannerWrap.style.display = "none";
}

scanBtn.addEventListener("click", startCamera);
closeBtn.addEventListener("click", stopCamera);