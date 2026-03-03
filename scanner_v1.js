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

  if (studentIdEl) studentIdEl.value = sid;
  setStatus(`Scanned ✅ (${source}) — logging…`);

  const logRes = await apiPost("logScan", {
    student_id: sid,
    device_name: navigator.userAgent,
  });

  if (!logRes.ok) {
    setStatus("Log error: " + (logRes.error || "unknown"));
    return;
  }

  if (!logRes.found) {
    if (nameEl) nameEl.textContent = "-";
    if (yearEl) yearEl.textContent = "-";
    if (teamEl) teamEl.textContent = "-";
    if (countEl) countEl.textContent = "-";
    setTierColor("");
    setStatus("Student not found.");
    return;
  }

  const st = logRes.student || {};
  if (nameEl) {
    nameEl.textContent =
      st.name || `${st.first_name || ""} ${st.last_name || ""}`.trim();
  }
  if (yearEl) yearEl.textContent = st.grade ?? st.class_year ?? "-";
  if (teamEl) teamEl.textContent = st.team || "-";

  if (countEl) countEl.textContent = String(logRes.total_count ?? "-");
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

lookupBtn?.addEventListener("click", () => handleId(studentIdEl?.value, "submit"));
studentIdEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleId(studentIdEl?.value, "enter");
});

/************ CAMERA ************/
let controls = null;
let track = null;

function buildReader() {
  const hints = new Map();

  // 14-digit numeric badge -> commonly ITF/ITF-14, sometimes CODE_128
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.ITF,
    BarcodeFormat.CODE_128,

    // harmless backups
    BarcodeFormat.EAN_13,
    BarcodeFormat.UPC_A,
    BarcodeFormat.CODABAR,
    BarcodeFormat.CODE_39,
  ]);

  hints.set(DecodeHintType.TRY_HARDER, true);

  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 20,
    delayBetweenScanSuccess: 250,
  });
}

function hardStopCamera() {
  // Stop ZXing
  try { controls?.stop(); } catch (_) {}
  controls = null;

  // Stop any active tracks on video element
  try {
    const s = videoEl?.srcObject;
    s?.getTracks?.().forEach((t) => t.stop());
  } catch (_) {}

  // Stop last known track too (extra safety)
  try { track?.stop(); } catch (_) {}
  track = null;

  // Detach stream
  try {
    if (videoEl) videoEl.srcObject = null;
  } catch (_) {}
}

async function pickBackCameraDeviceId(reader) {
  const devices = await reader.listVideoInputDevices();
  const byLabel =
    devices.find((d) => /back|rear|environment/i.test(d.label || "")) ||
    devices[devices.length - 1] ||
    devices[0];
  return byLabel?.deviceId;
}

async function startCamera() {
  setStatus("Opening camera…");

  // Always release anything leftover first (prevents “camera in use”)
  hardStopCamera();

  if (videoEl) {
    videoEl.setAttribute("playsinline", "");
    videoEl.muted = true;
    videoEl.autoplay = true;
    videoEl.style.width = "100%";
    videoEl.style.height = "100%";
    videoEl.style.objectFit = "cover";
  }

  const reader = buildReader();

  try {
    // Force permission prompt first (labels usually become available after this)
    const permStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    permStream.getTracks().forEach((t) => t.stop());

    const deviceId = await pickBackCameraDeviceId(reader);

    // ✅ Supported method on @zxing/browser@0.1.5
    controls = await reader.decodeFromVideoDevice(deviceId, videoEl, (result) => {
      if (!result) return;
      const text = result.getText?.();
      if (!text) return;
      handleId(String(text).trim(), "camera");
    });

    // Grab track (for cleanup reliability)
    try {
      const s = videoEl?.srcObject;
      track = s?.getVideoTracks?.()[0] || null;
    } catch (_) {}

    // iOS sometimes needs this
    try { await videoEl.play(); } catch (_) {}

    setStatus("Camera ready — scan the barcode.");
  } catch (e) {
    setStatus("Camera error: " + (e?.message || String(e)));
    hardStopCamera();
  }
}

function stopCamera() {
  hardStopCamera();
  setStatus("Camera stopped.");
}

scanBtn?.addEventListener("click", startCamera);
stopBtn?.addEventListener("click", stopCamera);

// If user backgrounds the tab, release camera
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hardStopCamera();
});

/************ WARM-UP ************/
(async () => {
  try { await apiGet("ping"); } catch (_) {}
  setStatus("Ready.");
})();
