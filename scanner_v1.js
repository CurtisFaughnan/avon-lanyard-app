import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";

const cfg = window.APP_CONFIG;

/************ ELEMENTS ************/
const titleEl = document.getElementById("title");
const studentIdEl = document.getElementById("studentId");
const lookupBtn = document.getElementById("lookupBtn");
const scanBtn = document.getElementById("scanBtn");
const statusEl = document.getElementById("status");

const nameEl = document.getElementById("name");
const yearEl = document.getElementById("year");
const teamEl = document.getElementById("team");
const countEl = document.getElementById("count");

const scannerWrap = document.getElementById("scanner");
const videoEl = document.getElementById("video");
const closeBtn = document.getElementById("closeScan");

// If your HTML still has emailBtn, hide it (portal mode)
const emailBtn = document.getElementById("emailBtn");
if (emailBtn) emailBtn.style.display = "none";

/************ INIT ************/
if (titleEl) titleEl.textContent = cfg?.appLabel || "Scanner App";
setStatus("Ready.");

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function clearStudentCard() {
  if (nameEl) nameEl.textContent = "-";
  if (yearEl) yearEl.textContent = "-";
  if (teamEl) teamEl.textContent = "-";
  if (countEl) countEl.textContent = "-";
}

/************ API ************/
// ✅ SPEED: ONE CALL ONLY (logScan returns student + count + tier)
async function apiLogScan(studentId) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("action", "logScan");

  const payload = {
    school_key: cfg.schoolKey,
    student_id: String(studentId || "").trim(),
    device_name: navigator.userAgent,
    ts: new Date().toISOString()
  };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  return await res.json();
}

/************ SUBMIT ************/
async function submitScan() {
  try {
    const sid = (studentIdEl?.value || "").trim();
    if (!sid) return setStatus("Enter a student ID.");

    setStatus("Logging...");
    const r = await apiLogScan(sid);

    if (!r.ok) return setStatus("Error: " + (r.error || "unknown"));

    if (!r.found) {
      clearStudentCard();
      return setStatus("Student not found.");
    }

    // logScan returns student + count
    const st = r.student || {};
    if (nameEl) nameEl.textContent = st.name || `${st.first_name || ""} ${st.last_name || ""}`.trim();
    if (yearEl) yearEl.textContent = st.grade ?? st.class_year ?? "-";
    if (teamEl) teamEl.textContent = st.team ?? "-";
    if (countEl) countEl.textContent = String(r.total_count ?? "-");

    // Optional tier UI (if your Code.gs returns tier)
    if (r.tier && r.tier.color) {
      // tint the status line or the card border
      statusEl.style.fontWeight = "bold";
      statusEl.style.color = r.tier.color;
      setStatus(`Logged. Tier: ${r.tier.label || ""}`.trim());
    } else {
      statusEl.style.color = "";
      setStatus("Logged.");
    }
  } catch (err) {
    setStatus("App error: " + String(err));
  }
}

lookupBtn?.addEventListener("click", submitScan);
studentIdEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitScan();
});

/************ CAMERA SCAN ************/
const reader = new BrowserMultiFormatReader();
let controls = null;

async function startCamera() {
  try {
    if (!scannerWrap || !videoEl) return setStatus("Camera UI not found.");

    scannerWrap.style.display = "block";
    setStatus("Opening camera...");

    // Pick back camera if possible
    const devices = await BrowserMultiFormatReader.listVideoInputDevices();
    let deviceId = null;

    if (devices && devices.length) {
      const back = devices.find(d => /back|rear|environment/i.test(d.label));
      deviceId = (back || devices[0]).deviceId;
    }

    // decodeFromVideoDevice is most reliable on phones
    controls = await reader.decodeFromVideoDevice(deviceId, videoEl, (result, err) => {
      if (result) {
        const text = result.getText();
        studentIdEl.value = text;
        stopCamera();
        submitScan();
      }
    });

    setStatus("Point at barcode...");
  } catch (err) {
    setStatus("Camera error: " + String(err));
    stopCamera();
  }
}

function stopCamera() {
  try {
    if (controls) controls.stop();
  } catch (_) {}
  controls = null;
  if (scannerWrap) scannerWrap.style.display = "none";
}

scanBtn?.addEventListener("click", startCamera);
closeBtn?.addEventListener("click", stopCamera);
