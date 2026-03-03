import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";
import { BarcodeFormat, DecodeHintType } from "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm";

const cfg = window.APP_CONFIG;

/************ ELEMENTS ************/
const titleEl = document.getElementById("title");
const studentIdEl = document.getElementById("studentId");
const lookupBtn = document.getElementById("lookupBtn");
const nameEl = document.getElementById("name");
const yearEl = document.getElementById("year");
const teamEl = document.getElementById("team");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("video");
const scanBtn = document.getElementById("scanBtn");
const stopBtn = document.getElementById("closeScan");
const cardEl = document.getElementById("card"); // optional

/************ INIT ************/
if (titleEl) titleEl.textContent = cfg?.appLabel || "Lanyard App";

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function setTierColor(colorCss) {
  if (!cardEl) return;
  if (!colorCss) {
    cardEl.style.borderColor = "#ccc";
    cardEl.classList.remove("tierGlow");
    return;
  }
  cardEl.style.borderColor = colorCss;
  cardEl.classList.add("tierGlow");
}

/************ API ************/
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

  // text/plain avoids CORS preflight in many browsers (good for iOS Safari)
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return await res.json();
}

/************ MAIN FLOW (FAST: 1 request) ************/
let lastScanned = "";
let lastScanAt = 0;
let processing = false;
let queuedId = null;

async function processScan(id, source) {
  const sid = String(id || "").trim();
  if (!sid) return;

  const now = Date.now();
  if (sid === lastScanned && now - lastScanAt < 1500) return;
  lastScanned = sid;
  lastScanAt = now;

  studentIdEl.value = sid;
  setStatus(`Scanned ✅ (${source}) — logging…`);

  // ✅ ONE CALL ONLY (backend logScan returns student + total_count + tier)
  const logRes = await apiPost("logScan", {
    student_id: sid,
    device_name: navigator.userAgent,
  });

  if (!logRes.ok) {
    setStatus("Log error: " + (logRes.error || "unknown"));
    return;
  }

  if (!logRes.found) {
    nameEl.textContent = "-";
    yearEl.textContent = "-";
    teamEl.textContent = "-";
    countEl.textContent = "-";
    setTierColor("");
    setStatus("Student not found.");
    return;
  }

  const st = logRes.student || {};
  nameEl.textContent =
    st.name || `${st.first_name || ""} ${st.last_name || ""}`.trim();
  yearEl.textContent = st.grade ?? st.class_year ?? "-";
  teamEl.textContent = st.team || "-";

  countEl.textContent = String(logRes.total_count ?? "-");
  const tier = logRes.tier || {};
  setTierColor(tier.color || "");
  setStatus(tier.label ? `Logged ✅ (${tier.label})` : "Logged ✅");
}

async function handleId(sid, source = "manual") {
  if (processing) {
    queuedId = String(sid || "").trim();
    return;
  }

  processing = true;
  try {
    await processScan(sid, source);
  } catch (err) {
    setStatus("Error: " + String(err));
  } finally {
    processing = false;
  }

  if (queuedId) {
    const next = queuedId;
    queuedId = null;
    setTimeout(() => handleId(next, "camera"), 250);
  }
}

lookupBtn?.addEventListener("click", () => handleId(studentIdEl.value, "submit"));
studentIdEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleId(studentIdEl.value, "enter");
});

/************ CAMERA ************/
let controls = null;
let track = null;

function buildReader() {
  // ✅ No hints = multi-format decoding (fixes “won’t scan” when barcode isn’t CODE_128)
  return new BrowserMultiFormatReader(undefined, {
    delayBetweenScanAttempts: 30,
    delayBetweenScanSuccess: 250,
  });
}

async function trySetZoom(z) {
  try {
    if (!track) return;
    const caps = track.getCapabilities?.();
    if (!caps?.zoom) return;
    const zoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min, z));
    await track.applyConstraints({ advanced: [{ zoom }] });
  } catch (_) {}
}

async function trySetFocusContinuous() {
  try {
    if (!track) return;
    const caps = track.getCapabilities?.();
    if (caps?.focusMode?.includes?.("continuous")) {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    }
  } catch (_) {}
}

async function startCamera() {
  if (controls) return;

  setStatus("Opening camera…");

  if (videoEl) {
    videoEl.setAttribute("playsinline", "");
    videoEl.muted = true;
    videoEl.autoplay = true;
    videoEl.style.width = "100%";
    videoEl.style.height = "100%";
    videoEl.style.objectFit = "cover";
  }

  const reader = buildReader();

  const constraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };

  try {
    controls = await reader.decodeFromConstraints(constraints, videoEl, (result) => {
      if (!result) return;
      const text = result.getText?.();
      if (!text) return;
      handleId(String(text).trim(), "camera");
    });

    const stream = videoEl?.srcObject;
    track = stream?.getVideoTracks?.()[0] || null;

    await trySetFocusContinuous();
    await trySetZoom(1.5);

    setStatus("Camera ready — scan a barcode.");
  } catch (e) {
    setStatus("Camera error: " + String(e));
    stopCamera();
  }
}

function stopCamera() {
  try { controls?.stop(); } catch (_) {}
  controls = null;

  try { track?.stop(); } catch (_) {}
  track = null;

  setStatus("Camera stopped.");
}

scanBtn?.addEventListener("click", startCamera);
stopBtn?.addEventListener("click", stopCamera);

/************ WARM-UP ************/
(async () => {
  try { await apiGet("ping"); } catch (_) {}
  setStatus("Ready.");
})();
