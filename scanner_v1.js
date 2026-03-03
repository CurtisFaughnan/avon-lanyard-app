// scanner_v1.js  (ES module)

// ZXing camera scanner (Skypack works well on GitHub Pages)
import { BrowserMultiFormatReader } from "https://cdn.skypack.dev/@zxing/browser@0.1.5";

const cfg = window.APP_CONFIG || {};
if (!cfg.apiUrl) {
  console.error("Missing APP_CONFIG.apiUrl in config.js");
}

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

// Optional elements (only if your HTML has them)
const tierEl = document.getElementById("tier");           // optional: shows tier label
const resultCardEl = document.getElementById("resultCard"); // optional: card to color
const pageWrapEl = document.getElementById("pageWrap");   // optional wrapper to color

const scannerWrap = document.getElementById("scanner");
const videoEl = document.getElementById("video");
const closeBtn = document.getElementById("closeScan");

/************ INIT ************/
if (titleEl) titleEl.textContent = cfg.appLabel || "Scanner App";
if (statusEl) statusEl.textContent = "Ready.";

// Email button starts hidden until a student is logged
if (emailBtn) emailBtn.style.display = "none";

/************ HELPERS ************/
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function safeText(el, txt) {
  if (el) el.textContent = txt ?? "";
}

function flashSuccess_() {
  // quick visual confirmation
  const el = resultCardEl || pageWrapEl || document.body;
  const prev = el.style.outline;
  el.style.outline = "4px solid rgba(0, 200, 83, 0.9)";
  setTimeout(() => (el.style.outline = prev), 300);
}

// Uses returned tier color/label to color UI
function applyTierUI_(tier, count) {
  if (!tier) return;

  // label
  if (tierEl) safeText(tierEl, tier.label ? `${tier.label} (count: ${count})` : `Count: ${count}`);

  // color: prefer coloring a card; fallback to page
  const color = tier.color || "";
  if (!color) return;

  const target = resultCardEl || pageWrapEl;
  if (target) {
    target.style.border = `4px solid ${color}`;
    target.style.boxShadow = `0 0 0 4px ${color}33`;
  } else {
    // last resort: tint background slightly (not full, just a hint)
    document.body.style.background = color;
  }
}

async function apiGet(action, params) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("school_key", cfg.schoolKey || "");

  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { method: "GET" });
  return await res.json();
}

async function apiPost(action, body) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", action);

  const payload = { ...(body || {}), school_key: cfg.schoolKey || "" };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  return await res.json();
}

/************ MAIN FLOW ************/
async function lookupAndLog() {
  try {
    const sid = (studentIdEl?.value || "").trim();
    if (!sid) {
      setStatus("Enter a student ID.");
      return;
    }

    // Hide email until we successfully log
    if (emailBtn) emailBtn.style.display = "none";
    setStatus("Looking up...");

    // 1) Lookup student
    const student = await apiGet("getStudent", { student_id: sid });

    if (!student.ok) {
      setStatus("Lookup error: " + (student.error || "unknown"));
      return;
    }

    if (!student.found) {
      setStatus("Student not found.");
      safeText(nameEl, "-");
      safeText(yearEl, "-");
      safeText(teamEl, "-");
      safeText(countEl, "-");
      if (tierEl) safeText(tierEl, "-");
      return;
    }

    safeText(nameEl, `${student.first_name} ${student.last_name}`.trim());
    safeText(yearEl, student.grade || student.class_year || "-"); // supports either field
    safeText(teamEl, student.team || "-");

    // 2) Log scan
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

    safeText(countEl, String(logRes.total_count ?? ""));
    setStatus("Logged.");
    flashSuccess_();

    // 3) Apply tier UI if provided
    applyTierUI_(logRes.tier, logRes.total_count);

    // 4) Enable Email Home with password prompt
    if (emailBtn) {
      emailBtn.style.display = "inline-block";
      emailBtn.onclick = async () => {
        const pass = prompt("Enter Email Home password:");
        if (!pass) {
          setStatus("Email canceled.");
          return;
        }

        try {
          emailBtn.disabled = true;
          setStatus("Sending email...");

          const emailRes = await apiPost("sendEmailHome", {
            student_id: sid,
            total_count: logRes.total_count,
            email_password: pass
          });

          setStatus(emailRes.ok ? "Email sent." : ("Email failed: " + (emailRes.error || "unknown")));
        } finally {
          emailBtn.disabled = false;
        }
      };
    }

  } catch (err) {
    setStatus("App error: " + String(err?.message || err));
  }
}

/************ INPUT EVENTS ************/
// USB scanners typically send digits then Enter
studentIdEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    lookupAndLog();
  }
});

lookupBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  lookupAndLog();
});

/************ CAMERA SCANNING ************/
let stopScanFn = null;

async function startCamera() {
  try {
    if (!scannerWrap || !videoEl) {
      setStatus("Camera UI missing in HTML (scanner/video).");
      return;
    }

    scannerWrap.style.display = "block";
    setStatus("Opening camera...");

    const reader = new BrowserMultiFormatReader();

    const controls = await reader.decodeFromConstraints(
      { video: { facingMode: "environment" } },
      videoEl,
      (result) => {
        if (result) {
          const text = result.getText();
          if (studentIdEl) studentIdEl.value = text;
          stopCamera();
          lookupAndLog();
        }
      }
    );

    stopScanFn = () => {
      try { controls.stop(); } catch (_) {}
    };

    setStatus("Scanning...");
  } catch (err) {
    setStatus("Camera error: " + String(err?.message || err));
    stopCamera();
  }
}

function stopCamera() {
  if (stopScanFn) stopScanFn();
  stopScanFn = null;

  if (scannerWrap) scannerWrap.style.display = "none";
}

scanBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  startCamera();
});

closeBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  stopCamera();
});
