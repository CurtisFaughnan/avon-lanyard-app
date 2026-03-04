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

const scanBtn = document.getElementById("scanBtn");
const scanOnceBtn = document.getElementById("scanOnceBtn");
const stopBtn = document.getElementById("closeScan");

const scannerEl = document.getElementById("scanner");
const cardEl = document.getElementById("card");

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

  // de-dupe double reads
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
  if (nameEl) nameEl.textContent = st.name || `${st.first_name || ""} ${st.last_name || ""}`.trim();
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
    setTimeout(() => handleId(next, "camera"), 200);
  }
}

lookupBtn?.addEventListener("click", () => handleId(studentIdEl?.value, "submit"));
studentIdEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleId(studentIdEl?.value, "enter");
});

/************ QUAGGA2 (Scan-on-button) ************/
let quaggaReady = false;
let quaggaRunning = false;
let lastDetectedCode = "";

// We capture the last detection but DON'T auto-log it.
// "Scan Now" decides when to submit.
function attachDetectedHandler() {
  Quagga.offDetected(onDetectedSafe);
  Quagga.onDetected(onDetectedSafe);
}

function onDetectedSafe(data) {
  const code = data?.codeResult?.code;
  if (!code) return;

  const cleaned = String(code).trim();

  // avoid flicker from repeated same value
  if (cleaned && cleaned !== lastDetectedCode) {
    lastDetectedCode = cleaned;
    setStatus(`Barcode found ✅ (${cleaned}) — tap "Scan Now"`);
  }
}

function stopScanner() {
  try {
    if (quaggaRunning) Quagga.stop();
  } catch (_) {}

  quaggaRunning = false;
  quaggaReady = false;
  lastDetectedCode = "";
  setStatus("Camera stopped.");
}

function startScanner() {
  if (!window.Quagga) {
    setStatus("Quagga2 not loaded — check index.html script tag.");
    return;
  }
  if (!scannerEl) {
    setStatus("Missing #scanner container in index.html");
    return;
  }

  stopScanner();
  setStatus("Opening camera…");

  const config = {
    inputStream: {
      type: "LiveStream",
      target: scannerEl, // ✅ DIV container (most reliable on iPhone)
      constraints: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      // match your guide box region
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
      // 14-digit badge is often ITF (i2of5); keep code_128 as fallback
      readers: ["i2of5_reader", "code_128_reader"],
      multiple: false,
    },
    numOfWorkers: 0, // iOS Safari is happiest without workers
  };

  Quagga.init(config, (err) => {
    if (err) {
      setStatus("Camera error: " + (err?.message || String(err)));
      return;
    }
    quaggaReady = true;
    quaggaRunning = true;
    attachDetectedHandler();
    Quagga.start();
    setStatus('Camera ready — point at barcode, then tap "Scan Now".');
  });
}

// ✅ Scan button: submit the last detected barcode
function scanNow() {
  if (!quaggaRunning) {
    setStatus('Camera not running. Tap "Start Camera" first.');
    return;
  }

  if (!lastDetectedCode) {
    setStatus("No barcode found yet — hold steady and try again.");
    return;
  }

  // submit the last seen code
  handleId(lastDetectedCode, "scan-now");
}

scanBtn?.addEventListener("click", startScanner);
scanOnceBtn?.addEventListener("click", scanNow);
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
