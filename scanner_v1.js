import { BrowserMultiFormatReader } from "https://cdn.skypack.dev/@zxing/browser@0.1.5";

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

if (titleEl) titleEl.textContent = cfg?.appLabel || "Scanner App";

/************ HELPERS ************/
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

/************ “FEELS FAST” FLOW ************/
/* 1) show "Scanned ✅" immediately
   2) lookup (optional)
   3) log
*/
async function handleId(sid, source = "manual") {
  const id = String(sid || "").trim();
  if (!id) return;

  studentIdEl.value = id;

  // Instant feedback (this is what fixes the “feels slow” part)
  setStatus(`Scanned ✅ (${source}) — logging…`);

  // Optional: show cached-ish student info first
  try {
    const student = await apiGet("getStudent", { student_id: id });
    if (student.ok && student.found) {
      nameEl.textContent = student.name || `${student.first_name || ""} ${student.last_name || ""}`.trim();
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
  } catch (_) {
    // even if lookup fails, still attempt log
  }

  // Log scan (the slow part)
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

/************ BUTTONS ************/
lookupBtn?.addEventListener("click", () => handleId(studentIdEl.value, "submit"));
studentIdEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleId(studentIdEl.value, "enter");
});

/************ CAMERA ************/
let stopFn = null;
let running = false;

async function startCamera() {
  if (running) return;
  running = true;

  try {
    setStatus("Opening camera…");

    const reader = new BrowserMultiFormatReader();

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

        // Stop scanning ASAP so it doesn't double-trigger
        stopCamera();

        // Handle the ID
        handleId(text.trim(), "camera");
      }
    );

    // Optional zoom help (if device supports it)
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
    setStatus("Camera ready — aim barcode inside box.");
  } catch (err) {
    setStatus("Camera error: " + String(err));
    stopCamera();
  } finally {
    running = false;
  }
}

function stopCamera() {
  try { if (stopFn) stopFn(); } catch (_) {}
  stopFn = null;
  running = false;
  setStatus("Camera stopped.");
}

scanBtn?.addEventListener("click", startCamera);
stopBtn?.addEventListener("click", stopCamera);

// Warm-up ping to reduce first-request cold start
(async () => {
  try {
    await apiGet("ping");
    setStatus("Ready.");
  } catch (_) {
    setStatus("Ready (no ping).");
  }
})();
