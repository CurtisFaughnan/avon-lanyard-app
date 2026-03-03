import { BrowserMultiFormatReader } from "https://cdn.skypack.dev/@zxing/browser@0.1.5";

const cfg = window.APP_CONFIG;

/************ ELEMENTS ************/
const titleEl = document.getElementById("title");
const studentIdEl = document.getElementById("studentId");
const lookupBtn = document.getElementById("lookupBtn");
const scanBtn = document.getElementById("scanBtn");

const nameEl = document.getElementById("name");
const yearEl = document.getElementById("year");
const teamEl = document.getElementById("team");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");

const scannerWrap = document.getElementById("scanner");
const videoEl = document.getElementById("video");
const closeBtn = document.getElementById("closeScan");

// the box that shows name/year/team/total
const infoBox = nameEl?.closest("div")?.parentElement; // your bordered card

/************ INIT ************/
if (titleEl) titleEl.textContent = cfg?.appLabel || "Scanner App";
setStatus("Loading…");

// warm up Apps Script to reduce first-scan slowness
warmUp().catch(() => {});

/************ HELPERS ************/
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function setTierColor(colorCss) {
  if (!infoBox) return;
  if (!colorCss) {
    infoBox.style.boxShadow = "";
    infoBox.style.border = "1px solid #ccc";
    return;
  }
  infoBox.style.border = `2px solid ${colorCss}`;
  infoBox.style.boxShadow = `0 0 0 4px ${colorCss}33`; // faint glow
}

function beep() {
  // tiny beep using WebAudio (works on most phones after user interaction)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 80);
  } catch (_) {}
}

async function apiGet(action, params) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("school_key", cfg.schoolKey);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  return await res.json();
}

async function apiPost(action, body) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);

  const payload = { ...(body || {}), school_key: cfg.schoolKey };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  return await res.json();
}

async function warmUp() {
  // only to reduce the "first request is slow" feeling
  const r = await apiGet("ping");
  if (r?.ok) setStatus("Ready.");
}

/************ LOOKUP + LOG ************/
async function lookupAndLog() {
  try {
    const sid = (studentIdEl?.value || "").trim();
    if (!sid) return setStatus("Enter a student ID.");

    setStatus("Looking up…");

    const student = await apiGet("getStudent", { student_id: sid });

    if (!student.ok) return setStatus("Lookup error: " + (student.error || "unknown"));

    if (!student.found) {
      setStatus("Student not found.");
      nameEl.textContent = "-";
      yearEl.textContent = "-";
      teamEl.textContent = "-";
      countEl.textContent = "-";
      setTierColor("");
      return;
    }

    nameEl.textContent = student.name || `${student.first_name || ""} ${student.last_name || ""}`.trim();
    yearEl.textContent = (student.grade ?? student.class_year ?? "-");
    teamEl.textContent = student.team || "-";

    setStatus("Logging…");

    const logRes = await apiPost("logScan", {
      student_id: sid,
      device_name: navigator.userAgent
    });

    if (!logRes.ok) return setStatus("Log error: " + (logRes.error || "unknown"));
    if (!logRes.found) return setStatus("Student not found (log).");

    countEl.textContent = String(logRes.total_count ?? "-");

    // tier color from Thresholds tab
    const tier = logRes.tier || {};
    setTierColor(tier.color || "");

    setStatus(tier.label ? `Logged (${tier.label}).` : "Logged.");
  } catch (err) {
    setStatus("App error: " + String(err));
  }
}

/************ BUTTON EVENTS ************/
lookupBtn?.addEventListener("click", lookupAndLog);
studentIdEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") lookupAndLog();
});

/************ CAMERA SCANNING ************/
let stopFn = null;

async function startCamera() {
  try {
    scannerWrap.style.display = "block";
    setStatus("Opening camera…");

    const reader = new BrowserMultiFormatReader();

    // better constraints for phones
    const constraints = {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    const controls = await reader.decodeFromConstraints(
      constraints,
      videoEl,
      (result) => {
        if (!result) return;
        const text = result.getText ? result.getText() : String(result);
        if (!text) return;

        // SUCCESS
        beep();
        studentIdEl.value = text.trim();
        stopCamera();
        lookupAndLog();
      }
    );

    // Try to apply zoom if supported (helps a lot on barcodes)
    try {
      const stream = videoEl.srcObject;
      const track = stream?.getVideoTracks?.()[0];
      const caps = track?.getCapabilities?.();
      if (caps?.zoom) {
        const z = Math.min(caps.zoom.max, Math.max(caps.zoom.min, 2));
        await track.applyConstraints({ advanced: [{ zoom: z }] });
      }
    } catch (_) {}

    stopFn = () => controls.stop();
    setStatus("Scanning… (aim at barcode lines)");
  } catch (err) {
    setStatus("Camera error: " + String(err));
    stopCamera();
  }
}

function stopCamera() {
  try { if (stopFn) stopFn(); } catch (_) {}
  stopFn = null;
  scannerWrap.style.display = "none";
}

scanBtn?.addEventListener("click", startCamera);
closeBtn?.addEventListener("click", stopCamera);
