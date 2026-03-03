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

const cardEl = document.getElementById("card");

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

/************ MAIN FLOW ************/
let lastScanned = "";
let lastScanAt = 0;

async function handleId(sid, source = "manual") {
  const id = String(sid || "").trim();
  if (!id) return;

  // de-dupe (prevents double logs if camera fires twice)
  const now = Date.now();
  if (id === lastScanned && (now - lastScanAt) < 1500) return;
  lastScanned = id;
  lastScanAt = now;

  studentIdEl.value = id;
  setStatus(`Scanned ✅ (${source}) — logging…`);

  // quick lookup for UI (optional)
  try {
    const student = await apiGet("getStudent", { student_id: id });
    if (student.ok && student.found) {
      nameEl.textContent =
        student.name || `${student.first_name || ""} ${student.last_name || ""}`.trim();
      yearEl.textContent = (student.grade ?? student.class_year ?? "-");
      teamEl.textContent = student.team || "-";
    } else {
      nameEl.textContent = "-";
      yearEl.textContent = "-";
      teamEl.textContent = "-";
      countEl.textContent = "-";
      setTierColor("");
      setStatus("Student not found.");
      return;
    }
  } catch (_) {}

  // log (slow part)
  try {
    const logRes = await apiPost("logScan", {
      student_id: id,
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
  } catch (err) {
    setStatus("Log error: " + String(err));
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
  // Restrict to Code 128 for speed + accuracy
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 60, // keep trying quickly
    delayBetweenScanSuccess: 300
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
  // optional: add a Torch button if not already there
  if (document.getElementById("torchBtn")) return;

  const controlsBar = document.getElementById("camControls");
  if (!controlsBar) return;

  const btn = document.createElement("button");
  btn.id = "torchBtn";
  btn.textContent = "Torch";
  btn.style.background = "#fff";
  btn.style.border = "none";
  btn.style.minWidth = "120px";

  let torchOn = false;
  btn.addEventListener("click", async () => {
    torchOn = !torchOn;
    const ok = await trySetTorch(torchOn);
    if (!ok) {
      torchOn = false;
      setStatus("Torch not supported on this device/browser.");
    } else {
      setStatus(torchOn ? "Torch ON" : "Torch OFF");
    }
  });

  controlsBar.appendChild(btn);
}

async function startCamera() {
  if (controls) return;

  setStatus("Opening camera…");

  const reader = buildReader();

  const constraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  try {
    controls = await reader.decodeFromConstraints(
      constraints,
      videoEl,
      async (result, err) => {
        // Keep trying; ignore not-found errors
        if (!result) return;

        const text = result.getText?.() || "";
        if (!text) return;

        // Do NOT stop the camera; just log and keep scanning
        await handleId(text.trim(), "camera");

        // small cooldown so you can move to next badge
        await new Promise(r => setTimeout(r, 800));
      }
    );

    // get track for zoom/torch tweaks
    const stream = videoEl.srcObject;
    track = stream?.getVideoTracks?.()[0] || null;

    // Zoom helps Code 128 on badges a LOT
    await trySetZoom(2.5);

    // Add Torch button if device supports it
    ensureTorchButton();

    setStatus("Camera ready — aim barcode inside box.");
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

/************ WARM-UP (reduces “first scan” slowness) ************/
(async () => {
  try {
    await apiGet("ping");
    setStatus("Ready.");
  } catch (_) {
    setStatus("Ready.");
  }
})();
