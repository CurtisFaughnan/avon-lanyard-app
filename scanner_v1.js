import {
  BrowserMultiFormatReader,
  BarcodeFormat,
  DecodeHintType
} from "https://cdn.skypack.dev/@zxing/browser@0.1.5";

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
if (titleEl) titleEl.textContent = cfg?.appLabel || "Scanner App";

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

function ensureScanOverlay() {
  // Creates a visible “put barcode here” box over the video (bottom half)
  if (document.getElementById("scanBoxOverlay")) return;

  const wrap = document.getElementById("scanner") || videoEl?.parentElement;
  if (!wrap) return;

  // make wrapper positionable
  if (wrap.style.position !== "fixed" && wrap.style.position !== "relative") {
    wrap.style.position = "fixed";
    wrap.style.inset = "0";
    wrap.style.background = "#000";
    wrap.style.zIndex = "9999";
  }

  const overlay = document.createElement("div");
  overlay.id = "scanBoxOverlay";
  overlay.style.position = "absolute";
  overlay.style.left = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.height = "50%";
  overlay.style.pointerEvents = "none";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const box = document.createElement("div");
  box.style.width = "86%";
  box.style.maxWidth = "520px";
  box.style.height = "45%";
  box.style.border = "4px solid rgba(255,255,255,0.9)";
  box.style.borderRadius = "18px";
  box.style.boxShadow = "0 0 0 9999px rgba(0,0,0,0.35) inset";
  box.style.display = "flex";
  box.style.alignItems = "center";
  box.style.justifyContent = "center";
  box.style.fontFamily = "Arial, sans-serif";
  box.style.fontSize = "18px";
  box.style.color = "white";
  box.style.textShadow = "0 1px 2px rgba(0,0,0,0.7)";
  box.textContent = "Place barcode inside box";

  overlay.appendChild(box);
  wrap.appendChild(overlay);
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
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  return await res.json();
}

/************ MAIN FLOW ************/
let lastScanned = "";
let lastScanAt = 0;

// prevent decode loop from being blocked
let processing = false;
let queuedId = null;

async function processScan(id, source) {
  const sid = String(id || "").trim();
  if (!sid) return;

  // de-dupe (prevents double logs if camera fires twice)
  const now = Date.now();
  if (sid === lastScanned && (now - lastScanAt) < 1500) return;
  lastScanned = sid;
  lastScanAt = now;

  studentIdEl.value = sid;
  setStatus(`Scanned ✅ (${source}) — logging…`);

  // Lookup for UI
  const student = await apiGet("getStudent", { student_id: sid });
  if (!student.ok) {
    setStatus("Lookup error: " + (student.error || "unknown"));
    return;
  }
  if (!student.found) {
    nameEl.textContent = "-";
    yearEl.textContent = "-";
    teamEl.textContent = "-";
    countEl.textContent = "-";
    setTierColor("");
    setStatus("Student not found.");
    return;
  }

  nameEl.textContent =
    student.name || `${student.first_name || ""} ${student.last_name || ""}`.trim();
  yearEl.textContent = (student.grade ?? student.class_year ?? "-");
  teamEl.textContent = student.team || "-";

  // Log (slow part)
  const logRes = await apiPost("logScan", {
    student_id: sid,
    device_name: navigator.userAgent
  });

  if (!logRes.ok) {
    setStatus("Log error: " + (logRes.error || "unknown"));
    return;
  }
  if (!logRes.found) {
    setStatus("Student not found (log).");
    return;
  }

  countEl.textContent = String(logRes.total_count ?? "-");
  const tier = logRes.tier || {};
  setTierColor(tier.color || "");
  setStatus(tier.label ? `Logged ✅ (${tier.label})` : "Logged ✅");
}

async function handleId(sid, source = "manual") {
  // queue latest scan if already processing
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

  // if something arrived while we were logging, process it next
  if (queuedId) {
    const next = queuedId;
    queuedId = null;
    // slight delay so user can move badge away
    setTimeout(() => handleId(next, "camera"), 250);
  }
}

lookupBtn?.addEventListener("click", () => handleId(studentIdEl.value, "submit"));
studentIdEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleId(studentIdEl.value, "enter");
});

/************ CAMERA (CODE 128 TUNED) ************/
let controls = null;
let track = null;

function buildReader() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 40,
    delayBetweenScanSuccess: 250
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

async function trySetTorch(on) {
  try {
    if (!track) return false;
    const caps = track.getCapabilities?.();
    if (!caps?.torch) return false;
    await track.applyConstraints({ advanced: [{ torch: !!on }] });
    return true;
  } catch (_) {
    return false;
  }
}

function ensureTorchButton() {
  // Put a torch button next to Close (only once)
  if (document.getElementById("torchBtn")) return;

  const wrap = document.getElementById("scanner") || videoEl?.parentElement;
  if (!wrap) return;

  const btn = document.createElement("button");
  btn.id = "torchBtn";
  btn.textContent = "Torch";
  btn.style.position = "absolute";
  btn.style.top = "12px";
  btn.style.right = "12px";
  btn.style.zIndex = "10000";
  btn.style.padding = "12px 14px";
  btn.style.fontSize = "16px";

  let torchOn = false;
  btn.addEventListener("click", async () => {
    torchOn = !torchOn;
    const ok = await trySetTorch(torchOn);
    if (!ok) {
      torchOn = false;
      setStatus("Torch not supported.");
    } else {
      setStatus(torchOn ? "Torch ON" : "Torch OFF");
    }
  });

  wrap.appendChild(btn);
}

async function startCamera() {
  if (controls) return;

  setStatus("Opening camera…");

  // iOS/Safari needs playsinline + muted for reliable autoplay
  if (videoEl) {
    videoEl.setAttribute("playsinline", "");
    videoEl.muted = true;
  }

  ensureScanOverlay();

  const reader = buildReader();

  const constraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  try {
    // IMPORTANT: callback is NOT async; do not await inside decode loop
    controls = await reader.decodeFromConstraints(
      constraints,
      videoEl,
      (result) => {
        if (!result) return;
        const text = result.getText?.();
        if (!text) return;
        handleId(String(text).trim(), "camera");
      }
    );

    const stream = videoEl?.srcObject;
    track = stream?.getVideoTracks?.()[0] || null;

    // Zoom helps a ton on badges
    await trySetZoom(2.5);

    ensureTorchButton();

    setStatus("Camera ready — put barcode in box (bottom half).");
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

  // remove torch button (optional)
  try { document.getElementById("torchBtn")?.remove(); } catch (_) {}

  setStatus("Camera stopped.");
}

scanBtn?.addEventListener("click", startCamera);
stopBtn?.addEventListener("click", stopCamera);

/************ WARM-UP (reduces “first scan” slowness) ************/
(async () => {
  try {
    await apiGet("ping");
  } catch (_) {}
  setStatus("Ready.");
})();
