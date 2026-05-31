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
const rpmNeedle = document.getElementById("rpmNeedle");
const rpmValue = document.getElementById("rpmValue");
const rpmX1000Value = document.getElementById("rpmX1000Value");
const rpmStateLabel = document.getElementById("rpmStateLabel");
const tachTickGroup = document.getElementById("tachTickGroup");
const tachNormalArc = document.getElementById("tachNormalArc");
const tachRedlineArc = document.getElementById("tachRedlineArc");
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

const TACH_CENTER_X = 160;
const TACH_CENTER_Y = 128;
const TACH_RADIUS_OUTER = 84;
const TACH_RADIUS_MAJOR = 70;
const TACH_RADIUS_MINOR = 76;
const TACH_LABEL_RADIUS = 56;
const TACH_NEEDLE_LENGTH = 73;
const TACH_MIN_RPM = 0;
const TACH_MAX_RPM = 9000;
const TACH_START_DEG = 150;
const TACH_END_DEG = 30;

function rpmToAngle(rpm) {
  const limited = clamp(rpm, TACH_MIN_RPM, TACH_MAX_RPM);
  return TACH_START_DEG + (limited / TACH_MAX_RPM) * (TACH_END_DEG - TACH_START_DEG);
}

function polarPoint(cx, cy, radius, deg) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy - radius * Math.sin(rad)
  };
}

function describeArc(cx, cy, radius, startDeg, endDeg) {
  const start = polarPoint(cx, cy, radius, startDeg);
  const end = polarPoint(cx, cy, radius, endDeg);
  const sweep = Math.abs(endDeg - startDeg);
  const largeArcFlag = sweep > 180 ? 1 : 0;
  const sweepFlag = endDeg < startDeg ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function renderTachometerFace() {
  if (!tachTickGroup) return;
  if (tachTickGroup.childNodes.length) return;

  for (let i = 0; i <= 45; i += 1) {
    const fraction = i / 45;
    const angle = TACH_START_DEG + fraction * (TACH_END_DEG - TACH_START_DEG);
    const major = i % 5 === 0;
    const outer = polarPoint(TACH_CENTER_X, TACH_CENTER_Y, TACH_RADIUS_OUTER, angle);
    const inner = polarPoint(TACH_CENTER_X, TACH_CENTER_Y, major ? TACH_RADIUS_MAJOR : TACH_RADIUS_MINOR, angle);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', outer.x.toFixed(2));
    line.setAttribute('y1', outer.y.toFixed(2));
    line.setAttribute('x2', inner.x.toFixed(2));
    line.setAttribute('y2', inner.y.toFixed(2));
    line.setAttribute('class', `tach-tick ${major ? 'major' : 'minor'}`);
    tachTickGroup.appendChild(line);

    if (major) {
      const labelValue = i / 5;
      const labelPoint = polarPoint(TACH_CENTER_X, TACH_CENTER_Y, TACH_LABEL_RADIUS, angle);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', labelPoint.x.toFixed(2));
      label.setAttribute('y', (labelPoint.y + 5).toFixed(2));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'tach-label');
      label.textContent = labelValue.toString();
      tachTickGroup.appendChild(label);
    }
  }

  if (tachNormalArc) {
    tachNormalArc.setAttribute('d', describeArc(TACH_CENTER_X, TACH_CENTER_Y, 86, 150, 48));
  }
  if (tachRedlineArc) {
    tachRedlineArc.setAttribute('d', describeArc(TACH_CENTER_X, TACH_CENTER_Y, 86, 48, 30));
  }
}

function updateAudioButton() {
  if (!audioToggle) return;
  audioToggle.classList.toggle("is-active", audioEnabled);
  audioToggle.textContent = audioEnabled ? "Engine Audio: On" : "Engine Audio: Off";
  audioToggle.setAttribute("aria-pressed", audioEnabled ? "true" : "false");
}

function setGauge(rpm) {
  if (!rpmNeedle || !rpmValue || !gaugeCard) return;
  const angle = rpmToAngle(rpm);
  const needlePoint = polarPoint(TACH_CENTER_X, TACH_CENTER_Y, TACH_NEEDLE_LENGTH, angle);
  rpmNeedle.setAttribute('x2', needlePoint.x.toFixed(2));
  rpmNeedle.setAttribute('y2', needlePoint.y.toFixed(2));
  rpmValue.textContent = Math.round(rpm).toString();
  if (rpmX1000Value) {
    rpmX1000Value.textContent = (rpm / 1000).toFixed(1);
  }
  if (rpmStateLabel) {
    rpmStateLabel.textContent = mode === 'hover'
      ? 'Rolling high-RPM sweep'
      : mode === 'burst'
      ? 'Driver blip / redline burst'
      : 'Idle sweep active';
  }
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
  renderTachometerFace();
requestAnimationFrame(animateGauge);
}

renderTachometerFace();
requestAnimationFrame(animateGauge);
