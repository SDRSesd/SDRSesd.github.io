const menuToggle = document.getElementById("menuToggle");
const navLinks = document.getElementById("navLinks");

if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => {
    navLinks.classList.toggle("open");
  });

  document.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.classList.remove("open");
    });
  });
}

const yearTarget = document.getElementById("year");
if (yearTarget) {
  yearTarget.textContent = new Date().getFullYear();
}

const gaugeCard = document.getElementById("rpmGaugeCard");
const needleWrap = document.getElementById("rpmNeedleWrap");
const rpmValue = document.getElementById("rpmValue");
const audioToggle = document.getElementById("audioToggle");

let mode = "idle";
let burstUntil = 0;
let audioReady = false;
let audioEnabled = false;
let audioCtx = null;
let engineGain = null;
let engineFilter = null;
let oscA = null;
let oscB = null;
let turboGain = null;
let turboFilter = null;
let turboNoise = null;
let masterGain = null;
const MAX_MASTER_GAIN = 0.38;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function rpmToAngle(rpm) {
  const limited = clamp(rpm, 0, 8500);
  return -120 + (limited / 8500) * 240;
}

function updateAudioButton() {
  if (!audioToggle) return;
  audioToggle.classList.toggle("is-active", audioEnabled);
  audioToggle.textContent = audioEnabled ? "Engine Audio: On" : "Engine Audio: Off";
  audioToggle.setAttribute("aria-pressed", audioEnabled ? "true" : "false");
}

function setGauge(rpm) {
  if (!needleWrap || !rpmValue || !gaugeCard) return;
  const angle = rpmToAngle(rpm);
  needleWrap.style.transform = `rotate(${angle}deg)`;
  rpmValue.textContent = Math.round(rpm).toString();
  gaugeCard.classList.toggle("is-redline", rpm >= 7200);
  updateAudio(rpm);
}

function createNoiseBuffer(context, seconds = 2) {
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, sampleRate * seconds, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function ensureAudio() {
  if (audioReady) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioCtx.destination);

  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = "lowpass";
  engineFilter.frequency.value = 380;

  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0.0001;

  oscA = audioCtx.createOscillator();
  oscA.type = "sawtooth";
  oscA.frequency.value = 55;

  oscB = audioCtx.createOscillator();
  oscB.type = "triangle";
  oscB.frequency.value = 110;

  oscA.connect(engineFilter);
  oscB.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(masterGain);

  turboFilter = audioCtx.createBiquadFilter();
  turboFilter.type = "bandpass";
  turboFilter.frequency.value = 1200;
  turboFilter.Q.value = 2.2;

  turboGain = audioCtx.createGain();
  turboGain.gain.value = 0.0001;

  turboNoise = audioCtx.createBufferSource();
  turboNoise.buffer = createNoiseBuffer(audioCtx, 2);
  turboNoise.loop = true;
  turboNoise.connect(turboFilter);
  turboFilter.connect(turboGain);
  turboGain.connect(masterGain);

  oscA.start();
  oscB.start();
  turboNoise.start();
  audioReady = true;
}

async function setAudioEnabled(enabled) {
  ensureAudio();
  if (audioCtx && audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
  audioEnabled = enabled;
  if (masterGain && audioCtx) {
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.setTargetAtTime(audioEnabled ? MAX_MASTER_GAIN : 0, audioCtx.currentTime, 0.03);
  }
  updateAudioButton();
}

function updateAudio(rpm) {
  if (!audioReady || !audioCtx) return;

  const now = audioCtx.currentTime;
  const baseHz = 42 + rpm / 88;
  const harmonicHz = baseHz * 1.98;

  oscA.frequency.setTargetAtTime(baseHz, now, 0.04);
  oscB.frequency.setTargetAtTime(harmonicHz, now, 0.04);

  engineFilter.frequency.setTargetAtTime(260 + rpm / 6, now, 0.06);
  engineGain.gain.setTargetAtTime(0.03 + rpm / 85000, now, 0.04);

  const spoolFactor = clamp((rpm - 3500) / 4500, 0, 1);
  turboFilter.frequency.setTargetAtTime(700 + spoolFactor * 1600, now, 0.08);
  turboGain.gain.setTargetAtTime(spoolFactor * 0.045, now, 0.08);
}

function makePopBang(strength = 1) {
  if (!audioReady || !audioCtx || !audioEnabled) return;

  const now = audioCtx.currentTime;
  const duration = 0.14 + Math.random() * 0.1;

  const popSource = audioCtx.createBufferSource();
  popSource.buffer = createNoiseBuffer(audioCtx, 0.25);

  const popFilter = audioCtx.createBiquadFilter();
  popFilter.type = "bandpass";
  popFilter.frequency.value = 900 + Math.random() * 1500;
  popFilter.Q.value = 0.9 + Math.random() * 2;

  const popGain = audioCtx.createGain();
  popGain.gain.setValueAtTime(0.0001, now);
  popGain.gain.linearRampToValueAtTime(0.12 * strength, now + 0.01);
  popGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  popSource.connect(popFilter);
  popFilter.connect(popGain);
  popGain.connect(masterGain);

  popSource.start(now);
  popSource.stop(now + duration + 0.02);

  const crack = audioCtx.createOscillator();
  const crackGain = audioCtx.createGain();
  crack.type = "square";
  crack.frequency.setValueAtTime(150 + Math.random() * 120, now);
  crackGain.gain.setValueAtTime(0.0001, now);
  crackGain.gain.linearRampToValueAtTime(0.035 * strength, now + 0.005);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  crack.connect(crackGain);
  crackGain.connect(masterGain);
  crack.start(now);
  crack.stop(now + 0.09);
}

function triggerOverrunPops() {
  if (!audioEnabled) return;
  const count = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i += 1) {
    setTimeout(() => makePopBang(0.8 + Math.random() * 0.3), i * (90 + Math.random() * 70));
  }
}

function triggerBurst() {
  mode = "burst";
  burstUntil = performance.now() + 1600;
}

if (audioToggle) {
  updateAudioButton();
  audioToggle.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await setAudioEnabled(!audioEnabled);
  });

  audioToggle.addEventListener("touchstart", (event) => {
    event.stopPropagation();
  }, { passive: true });
}

if (gaugeCard) {
  gaugeCard.addEventListener("mouseenter", async () => {
    if (audioEnabled && audioCtx && audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    mode = "hover";
  });

  gaugeCard.addEventListener("mouseleave", () => {
    if (mode !== "idle") {
      triggerOverrunPops();
    }
    mode = "idle";
  });

  gaugeCard.addEventListener("touchstart", async (event) => {
    if (event.target.closest("button")) return;
    if (audioEnabled && audioCtx && audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    triggerBurst();
  }, { passive: true });

  gaugeCard.addEventListener("click", async (event) => {
    if (event.target.closest("button")) return;
    if (audioEnabled && audioCtx && audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    triggerBurst();
  });
}

function animateGauge(timestamp) {
  let rpm = 3200;

  if (mode === "hover") {
    rpm = 7700 + 260 * Math.sin(timestamp / 90);
  } else if (mode === "burst") {
    if (timestamp >= burstUntil) {
      triggerOverrunPops();
      mode = "idle";
    } else {
      const progress = 1 - ((burstUntil - timestamp) / 1600);
      const rise = progress < 0.35
        ? 3200 + (progress / 0.35) * 5100
        : 8300 - ((progress - 0.35) / 0.65) * 650;
      rpm = rise + 180 * Math.sin(timestamp / 85);
    }
  }

  if (mode === "idle") {
    rpm = 2350 + 360 * Math.sin(timestamp / 720) + 110 * Math.sin(timestamp / 1950);
  }

  setGauge(rpm);
  requestAnimationFrame(animateGauge);
}

requestAnimationFrame(animateGauge);
