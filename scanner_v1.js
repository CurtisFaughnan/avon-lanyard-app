/* global Quagga */
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

/************ FAST LOGGING (1 request) ************/
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

/************ QUAGGA2 SCANNER ************/
let quaggaRunning = false;
let detectedHandler = null;

function ensureVideoInline() {
  if (!videoEl) return;
  videoEl.setAttribute("playsinline", "");
  videoEl.muted = true;
  videoEl.autoplay = true;
  videoEl.style.width = "100%";
  videoEl.style.height = "100%";
  videoEl.style.objectFit = "cover";
}

function stopScanner() {
  if (!window.Quagga) return;

  try {
    if (detectedHandler) Quagga.offDetected(detectedHandler);
  } catch (_) {}
  detectedHandler = null;

  try {
    if (quaggaRunning) Quagga.stop();
  } catch (_) {}

  quaggaRunning = false;
  setStatus("Camera stopped.");
}

async function startScanner() {
  if (!window.Quagga) {
    setStatus("Scanner library not loaded (Quagga). Check index.html script tag.");
    return;
  }

  // stop any previous run (prevents “camera in use”)
  stopScanner();
  ensureVideoInline();

  setStatus("Opening camera…");

  // IMPORTANT: this tells Quagga to use YOUR <video id="video"> element
  const config = {
    inputStream: {
      type: "LiveStream",
      target: videoEl,
      constraints: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },

      // Crop to the center area (like your guide box) -> faster & more accurate
      area: {
        top: "35%",
        right: "10%",
        left: "10%",
        bottom: "35%",
      },
    },

    locator: {
      halfSample: true,
      patchSize: "medium",
    },

    locate: true,

    decoder: {
      // Your badge is 14 digits (often ITF / Interleaved 2 of 5)
      // Also keep code_128 as fallback.
      readers: ["i2of5_reader", "code_128_reader"],
      multiple: false,
    },

    numOfWorkers: 0, // iOS Safari is happier without web workers
  };

  Quagga.init(config, (err) => {
    if (err) {
      setStatus("Camera error: " + (err?.message || String(err)));
      return;
    }

    quaggaRunning = true;
    Quagga.start();
    setStatus("Camera ready — scan the barcode.");

    detectedHandler = (data) => {
      const code = data?.codeResult?.code;
      if (code) handleId(String(code).trim(), "camera");
    };

    Quagga.onDetected(detectedHandler);
  });
}

scanBtn?.addEventListener("click", startScanner);
stopBtn?.addEventListener("click", stopScanner);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopScanner();
});

/************ WARM-UP ************/
(async () => {
  try {
    await apiGet("ping");
  } catch (_) {}
  setStatus("Ready.");
})();
