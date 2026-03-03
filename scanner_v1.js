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
let controls = null; // ZXing controls
let stream = null;

let detector = null; // BarcodeDetector
let detectRAF = 0;
let detectBusy = false;

function hardStopCamera() {
  // Stop BarcodeDetector loop
  try { cancelAnimationFrame(detectRAF); } catch (_) {}
  detectRAF = 0;
  detectBusy = false;

  // Stop ZXing
  try { controls?.stop(); } catch (_) {}
  controls = null;

  // Stop tracks
  try { stream?.getTracks?.().forEach((t) => t.stop()); } catch (_) {}
  stream = null;

  // Detach
  try { if (videoEl) videoEl.srcObject = null; } catch (_) {}
}

function setupVideoEl() {
  if (!videoEl) return;
  videoEl.setAttribute("playsinline", "");
  videoEl.muted = true;
  videoEl.autoplay = true;
  videoEl.style.width = "100%";
  videoEl.style.height = "100%";
  videoEl.style.objectFit = "cover";
}

async function startCamera() {
  setStatus("Opening camera…");
  hardStopCamera();
  setupVideoEl();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    videoEl.srcObject = stream;
    try { await videoEl.play(); } catch (_) {}

    // ✅ Prefer native BarcodeDetector (best on iPhone)
    if ("BarcodeDetector" in window) {
      // Most important formats for your badge:
      // ITF / CODE_128 are the big ones.
      detector = new BarcodeDetector({
        formats: ["itf", "code_128", "ean_13", "upc_a", "codabar", "code_39"],
      });

      setStatus("Detecting barcode…");

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const loop = async () => {
        detectRAF = requestAnimationFrame(loop);
        if (detectBusy) return;
        if (!videoEl.videoWidth || !videoEl.videoHeight) return;

        detectBusy = true;
        try {
          canvas.width = videoEl.videoWidth;
          canvas.height = videoEl.videoHeight;
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

          const results = await detector.detect(canvas);
          if (results && results.length) {
            const raw = results[0].rawValue || results[0].data || "";
            const text = String(raw).trim();
            if (text) handleId(text, "camera");
          }
        } catch (_) {
          // ignore per-frame errors
        } finally {
          detectBusy = false;
        }
      };

      loop();
      return;
    }

    // ✅ Fallback: ZXing
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.ITF,
      BarcodeFormat.CODE_128,
      BarcodeFormat.EAN_13,
      BarcodeFormat.UPC_A,
      BarcodeFormat.CODABAR,
      BarcodeFormat.CODE_39,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 20,
      delayBetweenScanSuccess: 250,
    });

    setStatus("Detecting barcode…");
    controls = await reader.decodeFromConstraints(
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      },
      videoEl,
      (result) => {
        if (!result) return;
        const text = result.getText?.();
        if (text) handleId(String(text).trim(), "camera");
      }
    );
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

document.addEventListener("visibilitychange", () => {
  if (document.hidden) hardStopCamera();
});

/************ WARM-UP ************/
(async () => {
  try { await apiGet("ping"); } catch (_) {}
  setStatus("Ready.");
})();
