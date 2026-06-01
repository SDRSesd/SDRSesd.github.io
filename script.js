const menuToggle = document.getElementById("menuToggle");
const navLinks = document.getElementById("navLinks");

if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => navLinks.classList.toggle("open"));
  document.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", () => navLinks.classList.remove("open"));
  });
}

const yearTarget = document.getElementById("year");
if (yearTarget) yearTarget.textContent = new Date().getFullYear();

const gaugeCard = document.getElementById("rpmGaugeCard");
const rpmNeedle = document.getElementById("rpmNeedle");
const rpmValue = document.getElementById("rpmValue");
const audioToggle = document.getElementById("audioToggle");
const engineStartBtn = document.getElementById("engineStartBtn");
const driveModeBtn = document.getElementById("driveModeBtn");
const acceleratorBtn = document.getElementById("acceleratorBtn");
const engineStatus = document.getElementById("engineStatus");
const driveModeStatus = document.getElementById("driveModeStatus");
const gearStatus = document.getElementById("gearStatus");
const throttleFill = document.getElementById("throttleFill");
const rpmNote = document.getElementById("rpmNote");

let engineRunning = false;
let audioEnabled = false;
let driveMode = false;
let acceleratorPressed = false;
let gear = 0;
let currentRpm = 0;
let currentSpeed = 0;
let throttle = 0;
let lastTimestamp = 0;
let lastGearShiftMs = 0;
let lastSpoolPopMs = 0;

let downshiftActive = false;
let downshiftQueue = [];
let downshiftNextMs = 0;
let downshiftBlipUntilMs = 0;
let finalGearHoldActive = false;
let finalGearHoldUntilMs = 0;
let finalGearCoastUntilMs = 0;
let coastToIdleActive = false;
let coastToIdleUntilMs = 0;

let audioReady = false;
let audioCtx = null;
let masterGain = null;
let engineGain = null;
let engineFilter = null;
let oscA = null;
let oscB = null;
let oscC = null;
let turboGain = null;
let turboFilter = null;
let turboNoise = null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function rpmToNeedlePoint(rpm) {
  const cx = 130;
  const cy = 120;
  const length = 72;
  const limited = clamp(rpm, 0, 8500);
  const angleDeg = 180 - (limited / 8500) * 180;
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + length * Math.cos(rad),
    y: cy - length * Math.sin(rad)
  };
}

function updateButtonStates() {
  if (engineStartBtn) {
    engineStartBtn.classList.toggle("is-running", engineRunning);
    engineStartBtn.textContent = engineRunning ? "Engine Stop" : "Engine Start";
    engineStartBtn.setAttribute("aria-pressed", engineRunning ? "true" : "false");
  }

  if (driveModeBtn) {
    driveModeBtn.classList.toggle("is-drive", driveMode);
    driveModeBtn.textContent = driveMode ? "Drive: On" : "Drive: Off";
    driveModeBtn.setAttribute("aria-pressed", driveMode ? "true" : "false");
  }

  if (acceleratorBtn) {
    acceleratorBtn.classList.toggle("is-pressed", acceleratorPressed);
    acceleratorBtn.classList.toggle("downshift-armed", downshiftActive);
    acceleratorBtn.textContent = acceleratorPressed
      ? "Accelerator: Holding"
      : downshiftActive
      ? "Rev-Match Downshift"
      : "Hold Accelerator";
    acceleratorBtn.setAttribute("aria-pressed", acceleratorPressed ? "true" : "false");
  }

  if (audioToggle) {
    audioToggle.classList.toggle("is-active", audioEnabled);
    audioToggle.textContent = audioEnabled ? "Audio: On" : "Audio: Off";
    audioToggle.setAttribute("aria-pressed", audioEnabled ? "true" : "false");
  }

  if (gaugeCard) {
    gaugeCard.classList.toggle("engine-running", engineRunning);
    gaugeCard.classList.toggle("drive-active", driveMode);
    gaugeCard.classList.toggle("downshift-active", downshiftActive);
  }

  if (engineStatus) engineStatus.textContent = engineRunning ? "ON" : "OFF";
  if (driveModeStatus) driveModeStatus.textContent = driveMode ? "D" : "N";
  if (gearStatus) gearStatus.textContent = driveMode ? String(Math.max(1, gear)) : "N";

  if (rpmNote) {
    if (!engineRunning) {
      rpmNote.textContent = "Engine stopped • press Engine Start to activate motorsport demo";
    } else if (!driveMode) {
      rpmNote.textContent = "Neutral mode • hold accelerator for free-rev and release for pops/bangs";
    } else if (downshiftActive) {
      rpmNote.textContent = "Rev-match downshift active • gears drop one by one with throttle blips, crackles and final 4.2K hold and coast-to-idle";
    } else {
      rpmNote.textContent = "Drive mode • hold accelerator for rolling pull, turbo spool, upshifts and release for downshift sequence";
    }
  }
}

function setGauge(rpm) {
  if (!rpmNeedle || !rpmValue || !gaugeCard) return;

  const point = rpmToNeedlePoint(rpm);
  rpmNeedle.setAttribute("x2", point.x.toFixed(2));
  rpmNeedle.setAttribute("y2", point.y.toFixed(2));
  rpmValue.textContent = Math.round(rpm).toString();

  gaugeCard.classList.toggle("is-redline", rpm >= 7200);

  if (throttleFill) throttleFill.style.width = `${Math.round(throttle * 100)}%`;

  updateAudio(rpm);
}

function createNoiseBuffer(context, seconds = 2) {
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, sampleRate * seconds, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
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
  engineFilter.frequency.value = 700;

  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0.0001;

  oscA = audioCtx.createOscillator();
  oscA.type = "sawtooth";
  oscB = audioCtx.createOscillator();
  oscB.type = "square";
  oscC = audioCtx.createOscillator();
  oscC.type = "triangle";

  oscA.connect(engineFilter);
  oscB.connect(engineFilter);
  oscC.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(masterGain);

  turboFilter = audioCtx.createBiquadFilter();
  turboFilter.type = "bandpass";
  turboFilter.frequency.value = 1400;
  turboFilter.Q.value = 3.2;

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
  oscC.start();
  turboNoise.start();

  audioReady = true;
}

async function setAudioEnabled(enabled) {
  ensureAudio();
  if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
  audioEnabled = enabled;

  if (masterGain && audioCtx) {
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.setTargetAtTime(audioEnabled ? 0.55 : 0, audioCtx.currentTime, 0.025);
  }

  updateButtonStates();
}

function updateAudio(rpm) {
  if (!audioReady || !audioCtx) return;

  const now = audioCtx.currentTime;

  if (!engineRunning) {
    engineGain.gain.setTargetAtTime(0.0001, now, 0.04);
    turboGain.gain.setTargetAtTime(0.0001, now, 0.04);
    return;
  }

  const baseHz = 42 + rpm / 70;
  oscA.frequency.setTargetAtTime(baseHz, now, 0.025);
  oscB.frequency.setTargetAtTime(baseHz * 1.92, now, 0.025);
  oscC.frequency.setTargetAtTime(baseHz * 0.5, now, 0.025);

  const engineLevel = 0.08 + (rpm / 8500) * 0.16 + throttle * 0.08 + (downshiftActive ? 0.08 : 0);
  engineFilter.frequency.setTargetAtTime(420 + rpm / 4.7, now, 0.045);
  engineGain.gain.setTargetAtTime(engineLevel, now, 0.035);

  // Turbo is purposely delayed: no strong turbo at normal idle.
  const spoolFactor = clamp((rpm - 3800) / 3600, 0, 1) * Math.max(throttle, downshiftActive ? 0.55 : 0);
  turboFilter.frequency.setTargetAtTime(900 + spoolFactor * 2400, now, 0.06);
  turboGain.gain.setTargetAtTime(spoolFactor * 0.16, now, 0.06);
}

function makePopBang(strength = 1) {
  if (!audioReady || !audioCtx || !audioEnabled || !engineRunning) return;

  const now = audioCtx.currentTime;
  const duration = 0.12 + Math.random() * 0.11;

  const popSource = audioCtx.createBufferSource();
  popSource.buffer = createNoiseBuffer(audioCtx, 0.25);

  const popFilter = audioCtx.createBiquadFilter();
  popFilter.type = "bandpass";
  popFilter.frequency.value = 850 + Math.random() * 1800;
  popFilter.Q.value = 0.9 + Math.random() * 2.1;

  const popGain = audioCtx.createGain();
  popGain.gain.setValueAtTime(0.0001, now);
  popGain.gain.linearRampToValueAtTime(0.18 * strength, now + 0.008);
  popGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  popSource.connect(popFilter);
  popFilter.connect(popGain);
  popGain.connect(masterGain);

  popSource.start(now);
  popSource.stop(now + duration + 0.02);

  const crack = audioCtx.createOscillator();
  const crackGain = audioCtx.createGain();
  crack.type = "square";
  crack.frequency.setValueAtTime(150 + Math.random() * 140, now);
  crackGain.gain.setValueAtTime(0.0001, now);
  crackGain.gain.linearRampToValueAtTime(0.060 * strength, now + 0.005);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
  crack.connect(crackGain);
  crackGain.connect(masterGain);
  crack.start(now);
  crack.stop(now + 0.09);
}

function triggerOverrunPops() {
  if (!audioEnabled || !engineRunning) return;
  const count = driveMode ? 3 : 2;
  for (let i = 0; i < count; i += 1) {
    setTimeout(() => makePopBang(0.9 + Math.random() * 0.35), i * (95 + Math.random() * 60));
  }
}

function triggerGearshiftPop() {
  if (!audioEnabled || !engineRunning) return;
  makePopBang(0.45);
}

function triggerDownshiftBlip(intensity = 1) {
  if (!engineRunning) return;
  downshiftBlipUntilMs = performance.now() + 390;
  throttle = Math.max(throttle, 0.72);
  currentRpm = clamp(currentRpm + 1550 * intensity, 1600, 8200);

  if (audioEnabled) {
    makePopBang(0.8 * intensity);
    setTimeout(() => makePopBang(0.6 * intensity), 110);
  }
}

function startDownshiftSequence() {
  if (!engineRunning || !driveMode || gear <= 1) return;

  downshiftQueue = [];
  for (let g = gear - 1; g >= 1; g -= 1) {
    downshiftQueue.push(g);
  }

  if (!downshiftQueue.length) return;

  downshiftActive = true;
  downshiftNextMs = performance.now() + 220;
  triggerOverrunPops();
  updateButtonStates();
}

function processDownshiftSequence(timestamp) {
  if (!downshiftActive) return;

  if (timestamp >= downshiftNextMs && downshiftQueue.length) {
    gear = downshiftQueue.shift();
    const intensity = clamp(1 + (6 - gear) * 0.11, 1, 1.55);
    triggerDownshiftBlip(intensity);
    triggerOverrunPops();
    downshiftNextMs = timestamp + 620;
    updateButtonStates();
  }

  if (!downshiftQueue.length && timestamp > downshiftNextMs + 450) {
    downshiftActive = false;
    throttle = 0;

    // After final 1st gear downshift, hold around 4.2K briefly to mimic
    // engine braking while the driveline is still connected, then coast down.
    finalGearHoldActive = true;
    finalGearHoldUntilMs = timestamp + 1350;
    finalGearCoastUntilMs = timestamp + 3400;

    coastToIdleActive = false;
    coastToIdleUntilMs = 0;
    updateButtonStates();
  }
}


async function startEngine() {
  ensureAudio();
  if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
  engineRunning = true;
  audioEnabled = true;
  gear = driveMode ? 1 : 0;
  currentRpm = Math.max(currentRpm, 950);
  updateButtonStates();

  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(0.55, audioCtx.currentTime, 0.025);
  }
}

function stopEngine() {
  if (acceleratorPressed) triggerOverrunPops();
  engineRunning = false;
  acceleratorPressed = false;
  driveMode = false;
  downshiftActive = false;
  downshiftQueue = [];
  coastToIdleActive = false;
  coastToIdleUntilMs = 0;
  finalGearHoldActive = false;
  finalGearHoldUntilMs = 0;
  finalGearCoastUntilMs = 0;
  gear = 0;
  throttle = 0;
  currentSpeed = 0;
  updateButtonStates();
}

function setDriveMode(enabled) {
  driveMode = enabled;
  downshiftActive = false;
  downshiftQueue = [];
  coastToIdleActive = false;
  coastToIdleUntilMs = 0;
  finalGearHoldActive = false;
  finalGearHoldUntilMs = 0;
  finalGearCoastUntilMs = 0;
  if (driveMode && engineRunning) {
    gear = 1;
    currentSpeed = Math.max(currentSpeed, 8);
  } else {
    gear = 0;
    currentSpeed = 0;
  }
  updateButtonStates();
}

function setAcceleratorPressed(pressed) {
  if (!engineRunning) return;
  acceleratorPressed = pressed;
  if (pressed) {
    coastToIdleActive = false;
    coastToIdleUntilMs = 0;
    finalGearHoldActive = false;
    finalGearHoldUntilMs = 0;
    finalGearCoastUntilMs = 0;
  }
  if (!pressed) {
    if (driveMode && gear > 1) startDownshiftSequence();
    else triggerOverrunPops();
  }
  updateButtonStates();
}

function updateVehicleState(timestamp) {
  const dt = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 0.05) : 0.016;
  lastTimestamp = timestamp;

  processDownshiftSequence(timestamp);

  const targetThrottle = engineRunning && (acceleratorPressed || downshiftActive) ? (downshiftActive ? 0.55 : 1) : 0;
  const throttleRate = targetThrottle > throttle ? 2.6 : 3.8;
  throttle += (targetThrottle - throttle) * clamp(dt * throttleRate, 0, 1);

  if (!engineRunning) {
    currentRpm += (0 - currentRpm) * clamp(dt * 2.4, 0, 1);
    currentSpeed += (0 - currentSpeed) * clamp(dt * 2.4, 0, 1);
    setGauge(currentRpm);
    return;
  }

  if (!driveMode) {
    // Neutral mode: keep previous feature. Free-rev, redline, release pops.
    const targetRpm = acceleratorPressed
      ? 7600 + 260 * Math.sin(timestamp / 85)
      : 1050 + 90 * Math.sin(timestamp / 520);
    currentRpm += (targetRpm - currentRpm) * clamp(dt * (acceleratorPressed ? 5.5 : 2.2), 0, 1);
    currentSpeed += (0 - currentSpeed) * clamp(dt * 2.4, 0, 1);
  } else {
    // Drive mode: rolling pull with auto shift.
    if (gear < 1) gear = 1;

    const gearRatios = [0, 2.9, 2.1, 1.55, 1.18, 0.94, 0.78];
    const finalDrive = 36;
    const ratio = gearRatios[gear] || 1;

    if (acceleratorPressed && !downshiftActive) {
      currentSpeed += (18 / gear) * throttle * dt;
      currentSpeed = clamp(currentSpeed, 0, 245);
    } else {
      currentSpeed -= (downshiftActive ? 7 : 18) * dt;
      currentSpeed = Math.max(0, currentSpeed);
    }

    const rollingRpm = 900 + currentSpeed * ratio * finalDrive;
    let targetRpm = acceleratorPressed
      ? clamp(rollingRpm + throttle * 1500, 1200, 8200)
      : clamp(rollingRpm, 950, 4200);

    if (!acceleratorPressed && !downshiftActive && gear <= 1 && finalGearHoldActive) {
      if (timestamp <= finalGearHoldUntilMs) {
        // Hold around 4.2K for a short engine-braking feel.
        targetRpm = 4200 + 90 * Math.sin(timestamp / 130);
        currentSpeed = Math.max(currentSpeed - 5 * dt, 12);
      } else {
        // Then coast down smoothly to idle.
        const coastProgress = clamp((timestamp - finalGearHoldUntilMs) / Math.max(finalGearCoastUntilMs - finalGearHoldUntilMs, 1), 0, 1);
        const coastTarget = 4200 - coastProgress * 3150;
        targetRpm = Math.max(1050 + 70 * Math.sin(timestamp / 420), coastTarget);
        currentSpeed -= 26 * dt;
        currentSpeed = Math.max(0, currentSpeed);

        if (timestamp >= finalGearCoastUntilMs || currentSpeed < 7) {
          finalGearHoldActive = false;
          coastToIdleActive = false;
        }
      }
    }

    if (downshiftActive && timestamp < downshiftBlipUntilMs) {
      targetRpm = clamp(Math.max(targetRpm, currentRpm + 600), 2500, 8200);
    }

    currentRpm += (targetRpm - currentRpm) * clamp(dt * (downshiftActive || finalGearHoldActive ? 5.6 : 4.0), 0, 1);

    if (acceleratorPressed && !downshiftActive && currentRpm > 6900 && gear < 6 && timestamp - lastGearShiftMs > 650) {
      gear += 1;
      lastGearShiftMs = timestamp;
      currentRpm -= 2100;
      triggerGearshiftPop();
      updateButtonStates();
    }

    if (!acceleratorPressed && !downshiftActive && currentSpeed < 9) {
      gear = 1;
      updateButtonStates();
    }

    if (currentRpm > 3900 && throttle > 0.65 && timestamp - lastSpoolPopMs > 1800) {
      lastSpoolPopMs = timestamp;
      // tiny acoustic character while boost builds
      if (audioEnabled) makePopBang(0.18);
    }
  }

  setGauge(currentRpm);
}

if (engineStartBtn) {
  engineStartBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (engineRunning) stopEngine();
    else await startEngine();
  });
}

if (driveModeBtn) {
  driveModeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!engineRunning) return;
    setDriveMode(!driveMode);
  });
}

if (acceleratorBtn) {
  acceleratorBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAcceleratorPressed(true);
  });

  acceleratorBtn.addEventListener("mouseup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAcceleratorPressed(false);
  });

  acceleratorBtn.addEventListener("mouseleave", () => {
    if (acceleratorPressed) setAcceleratorPressed(false);
  });

  acceleratorBtn.addEventListener("touchstart", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAcceleratorPressed(true);
  }, { passive: false });

  acceleratorBtn.addEventListener("touchend", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAcceleratorPressed(false);
  }, { passive: false });
}

if (audioToggle) {
  updateButtonStates();
  audioToggle.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await setAudioEnabled(!audioEnabled);
  });

  audioToggle.addEventListener("touchstart", (event) => event.stopPropagation(), { passive: true });
}

if (gaugeCard) {
  // Keep hover/tap free-rev behavior in Neutral mode only, as requested.
  gaugeCard.addEventListener("mouseenter", () => {
    if (engineRunning && !driveMode && !acceleratorPressed) setAcceleratorPressed(true);
  });

  gaugeCard.addEventListener("mouseleave", () => {
    if (engineRunning && !driveMode && acceleratorPressed) setAcceleratorPressed(false);
  });
}

function animationLoop(timestamp) {
  updateVehicleState(timestamp);
  requestAnimationFrame(animationLoop);
}

updateButtonStates();
requestAnimationFrame(animationLoop);




const modeToggleBtn = document.getElementById("modeToggleBtn");
let themeAudioCtx = null;

function ensureThemeAudio() {
  if (themeAudioCtx) return themeAudioCtx;
  themeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return themeAudioCtx;
}

async function playTrackModeRumble() {
  try {
    const ctx = ensureThemeAudio();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(0.20, now + 0.05);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
    master.connect(ctx.destination);

    const low = ctx.createOscillator();
    low.type = "sawtooth";
    low.frequency.setValueAtTime(56, now);
    low.frequency.exponentialRampToValueAtTime(42, now + 0.82);

    const mid = ctx.createOscillator();
    mid.type = "triangle";
    mid.frequency.setValueAtTime(84, now);
    mid.frequency.exponentialRampToValueAtTime(62, now + 0.82);

    const lowGain = ctx.createGain();
    lowGain.gain.setValueAtTime(0.18, now);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);

    const midGain = ctx.createGain();
    midGain.gain.setValueAtTime(0.10, now);
    midGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(220, now);
    filter.Q.value = 0.9;

    low.connect(lowGain);
    mid.connect(midGain);
    lowGain.connect(filter);
    midGain.connect(filter);
    filter.connect(master);

    low.start(now);
    mid.start(now);
    low.stop(now + 0.85);
    mid.stop(now + 0.85);
  } catch (e) {
    // ignore audio errors
  }
}

function updateModeToggleLabel(isTrack) {
  if (!modeToggleBtn) return;
  modeToggleBtn.textContent = isTrack ? "Street Mode" : "Track Mode";
  modeToggleBtn.setAttribute("aria-label", isTrack ? "Switch to Street Mode" : "Switch to Track Mode");
  modeToggleBtn.setAttribute("title", isTrack ? "Switch to Street Mode" : "Switch to Track Mode");
}

function applyThemeMode(mode, playSound = false) {
  const isTrack = mode === "track";
  const wasTrack = document.body.classList.contains("track-mode");
  document.body.classList.toggle("track-mode", isTrack);
  updateModeToggleLabel(isTrack);

  try {
    localStorage.setItem("portfolioThemeMode", mode);
  } catch (e) {}

  if (playSound && isTrack && !wasTrack) {
    playTrackModeRumble();
  }
}

if (modeToggleBtn) {
  modeToggleBtn.addEventListener("click", () => {
    const isTrack = document.body.classList.contains("track-mode");
    const nextMode = isTrack ? "street" : "track";
    applyThemeMode(nextMode, true);
    if (nextMode === "track") playTrackModeRumble();
  });
}

try {
  const savedMode = localStorage.getItem("portfolioThemeMode");
  applyThemeMode(savedMode === "track" ? "track" : "street");
} catch (e) {
  applyThemeMode("street");
}



/* Track mode engine rumble */
let trackRumbleCtx = null;

function ensureTrackRumbleAudio() {
  if (trackRumbleCtx) return trackRumbleCtx;
  trackRumbleCtx = new (window.AudioContext || window.webkitAudioContext)();
  return trackRumbleCtx;
}

async function playTrackModeRumble() {
  try {
    const ctx = ensureTrackRumbleAudio();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(0.24, now + 0.05);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
    master.connect(ctx.destination);

    const low = ctx.createOscillator();
    low.type = "sawtooth";
    low.frequency.setValueAtTime(64, now);
    low.frequency.exponentialRampToValueAtTime(43, now + 0.9);

    const mid = ctx.createOscillator();
    mid.type = "triangle";
    mid.frequency.setValueAtTime(96, now);
    mid.frequency.exponentialRampToValueAtTime(58, now + 0.9);

    const lowGain = ctx.createGain();
    lowGain.gain.setValueAtTime(0.20, now);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);

    const midGain = ctx.createGain();
    midGain.gain.setValueAtTime(0.09, now);
    midGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(140, now + 0.9);
    filter.Q.value = 0.8;

    low.connect(lowGain);
    mid.connect(midGain);
    lowGain.connect(filter);
    midGain.connect(filter);
    filter.connect(master);

    low.start(now);
    mid.start(now);
    low.stop(now + 0.95);
    mid.stop(now + 0.95);
  } catch (e) {
    // Browser may block audio until a user gesture; ignore silently.
  }
}
