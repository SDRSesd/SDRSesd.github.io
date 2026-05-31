
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
const speedValue = document.getElementById("speedValue");
const gearValue = document.getElementById("gearValue");
const clusterMode = document.getElementById("clusterMode");
const boostValue = document.getElementById("boostValue");
const boostFill = document.getElementById("boostFill");
const clusterNote = document.getElementById("clusterNote");
const audioToggle = document.getElementById("audioToggle");
const launchBtn = document.getElementById("launchBtn");
const blipBtn = document.getElementById("blipBtn");

let mode = "idle";
let hoverRev = false;
let launchStart = null;
let blipStart = null;

let audioReady = false;
let audioCtx = null;
let engineGain = null;
let engineFilter = null;
let oscA = null;
let oscB = null;
let turboGain = null;
let turboFilter = null;
let turboNoise = null;
let masterGain = null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function rpmToAngle(rpm) {
  const limited = clamp(rpm, 0, 8500);
  return -120 + (limited / 8500) * 240;
}

function formatSpeed(speed) {
  return String(Math.round(speed)).padStart(3, "0");
}

function updateCluster({ rpm, speed, gear, boost, label, note, highlight = false, launch = false }) {
  if (!gaugeCard || !needleWrap || !rpmValue) return;

  const angle = rpmToAngle(rpm);
  needleWrap.style.transform = `rotate(${angle}deg)`;
  rpmValue.textContent = Math.round(rpm).toString();

  if (speedValue) speedValue.textContent = formatSpeed(speed);
  if (gearValue) gearValue.textContent = gear;
  if (clusterMode) clusterMode.textContent = label;
  if (boostValue) boostValue.textContent = `${boost.toFixed(1)} bar`;
  if (boostFill) boostFill.style.width = `${clamp((boost / 1.8) * 100, 0, 100)}%`;
  if (clusterNote) clusterNote.textContent = note;

  gaugeCard.classList.toggle("is-redline", highlight || rpm >= 7200);
  gaugeCard.classList.toggle("is-launch", launch);
  updateAudio(rpm, boost);
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
  masterGain.gain.value = 0.38;
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
  if (audioToggle) {
    audioToggle.classList.add("is-active");
    audioToggle.textContent = "Engine Audio On";
  }
}

async function resumeAudio() {
  if (audioCtx && audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
}

function updateAudio(rpm, boost = 0) {
  if (!audioReady || !audioCtx) return;
  const now = audioCtx.currentTime;
  const baseHz = 42 + rpm / 88;
  const harmonicHz = baseHz * 1.98;

  oscA.frequency.setTargetAtTime(baseHz, now, 0.04);
  oscB.frequency.setTargetAtTime(harmonicHz, now, 0.04);
  engineFilter.frequency.setTargetAtTime(260 + rpm / 6, now, 0.06);
  engineGain.gain.setTargetAtTime(0.03 + rpm / 85000, now, 0.04);

  const spoolFactor = clamp((rpm - 3500) / 4500, 0, 1);
  const effectiveBoost = Math.max(spoolFactor, boost / 1.8);
  turboFilter.frequency.setTargetAtTime(700 + effectiveBoost * 1600, now, 0.08);
  turboGain.gain.setTargetAtTime(effectiveBoost * 0.045, now, 0.08);
}

function makePopBang(strength = 1) {
  if (!audioReady || !audioCtx) return;

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
  if (!audioReady) return;
  const count = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i += 1) {
    setTimeout(() => makePopBang(0.8 + Math.random() * 0.3), i * (90 + Math.random() * 70));
  }
}

function startLaunchSequence() {
  launchStart = performance.now();
  blipStart = null;
  mode = "launch";
}

function startBlipSequence() {
  blipStart = performance.now();
  if (mode !== "launch") mode = "blip";
}

if (audioToggle) {
  audioToggle.addEventListener("click", async () => {
    ensureAudio();
    await resumeAudio();
  });
}

if (launchBtn) {
  launchBtn.addEventListener("click", async () => {
    ensureAudio();
    await resumeAudio();
    startLaunchSequence();
  });
}

if (blipBtn) {
  blipBtn.addEventListener("click", async () => {
    ensureAudio();
    await resumeAudio();
    startBlipSequence();
  });
}

if (gaugeCard) {
  gaugeCard.addEventListener("mouseenter", async () => {
    hoverRev = true;
    ensureAudio();
    await resumeAudio();
  });

  gaugeCard.addEventListener("mouseleave", () => {
    if (hoverRev && mode === "hover") {
      triggerOverrunPops();
    }
    hoverRev = false;
    if (mode === "hover") mode = "idle";
  });

  gaugeCard.addEventListener("touchstart", async () => {
    ensureAudio();
    await resumeAudio();
    hoverRev = true;
    startBlipSequence();
  }, { passive: true });
}

function computeIdleState(timestamp) {
  return {
    rpm: 2350 + 360 * Math.sin(timestamp / 720) + 110 * Math.sin(timestamp / 1950),
    speed: 0,
    gear: "N",
    boost: 0.1,
    label: "IDLE",
    note: "Idle sweep active • launch-control and rev-match animation ready",
    highlight: false,
    launch: false
  };
}

function computeHoverState(timestamp) {
  return {
    rpm: 7600 + 240 * Math.sin(timestamp / 90),
    speed: 0,
    gear: "N",
    boost: 0.3,
    label: "FREE REV",
    note: "Free-rev sweep active • release for overrun crackles",
    highlight: true,
    launch: false
  };
}

function computeBlipState(timestamp) {
  const elapsed = timestamp - blipStart;
  if (elapsed > 900) {
    blipStart = null;
    mode = hoverRev ? "hover" : "idle";
    return null;
  }

  const phase = elapsed / 900;
  const rpm = phase < 0.4
    ? 2900 + (phase / 0.4) * 2500
    : 5400 - ((phase - 0.4) / 0.6) * 2200;

  if (elapsed > 120 && elapsed < 220 && audioReady) {
    makePopBang(0.35);
  }

  return {
    rpm,
    speed: 72,
    gear: phase < 0.35 ? "4" : "3",
    boost: 0.3,
    label: "BLIP",
    note: "Rev-match blip demo • throttle stab and downshift transition",
    highlight: phase < 0.45,
    launch: false
  };
}

function computeLaunchState(timestamp) {
  const elapsed = timestamp - launchStart;

  if (elapsed > 5200) {
    launchStart = null;
    triggerOverrunPops();
    mode = hoverRev ? "hover" : "idle";
    return null;
  }

  if (elapsed < 900) {
    return {
      rpm: 4200 + 220 * Math.sin(timestamp / 80),
      speed: 0,
      gear: "1",
      boost: 0.6,
      label: "LAUNCH",
      note: "Launch control armed • boost building off the line",
      highlight: false,
      launch: true
    };
  }

  const run = elapsed - 900;

  let gear = "1";
  let speed = 0;
  let rpm = 0;
  let boost = 1.2;

  if (run < 1100) {
    const p = run / 1100;
    speed = 12 + p * 42;
    rpm = 4300 + p * 2900;
    gear = "1";
  } else if (run < 2200) {
    const p = (run - 1100) / 1100;
    speed = 54 + p * 38;
    rpm = 4900 + p * 2400;
    gear = "2";
    if (p < 0.08 && audioReady) makePopBang(0.22);
  } else if (run < 3300) {
    const p = (run - 2200) / 1100;
    speed = 92 + p * 34;
    rpm = 5000 + p * 2200;
    gear = "3";
    if (p < 0.08 && audioReady) makePopBang(0.18);
  } else {
    const p = (run - 3300) / 1100;
    speed = 126 + p * 30;
    rpm = 5200 + p * 2000;
    gear = "4";
  }

  return {
    rpm,
    speed,
    gear,
    boost,
    label: "SPORT",
    note: "Launch-control demo active • staged acceleration with shift transitions",
    highlight: rpm >= 7000,
    launch: true
  };
}

function animateCluster(timestamp) {
  let state = null;

  if (launchStart !== null || mode === "launch") {
    mode = "launch";
    state = computeLaunchState(timestamp);
  }

  if (!state && blipStart !== null) {
    mode = "blip";
    state = computeBlipState(timestamp);
  }

  if (!state) {
    mode = hoverRev ? "hover" : "idle";
    state = mode === "hover" ? computeHoverState(timestamp) : computeIdleState(timestamp);
  }

  if (state) {
    updateCluster(state);
  }

  requestAnimationFrame(animateCluster);
}

requestAnimationFrame(animateCluster);
