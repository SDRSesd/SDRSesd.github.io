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
    acceleratorBtn.classList.toggle("downshift-armed", downshiftActive || finalGearHoldActive);
    acceleratorBtn.textContent = acceleratorPressed
      ? "Accelerator: Holding"
      : downshiftActive
      ? "Rev-Match Downshift"
      : finalGearHoldActive
      ? "Engine Braking Hold"
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
    gaugeCard.classList.toggle("downshift-active", downshiftActive || finalGearHoldActive);
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
      rpmNote.textContent = "Rev-match downshift active • step-down gears with blips, crackles and intensity";
    } else if (finalGearHoldActive) {
      rpmNote.textContent = "1st gear engine braking hold • approx. 4.2K RPM before smooth coast-to-idle";
    } else {
      rpmNote.textContent = "Drive mode • hold accelerator for rolling pull, turbo spool and auto gearshift";
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

async function resumeAudioIfNeeded() {
  if (audioCtx && audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
}

async function setAudioEnabled(enabled) {
  ensureAudio();
  await resumeAudioIfNeeded();

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

  const downshiftBite = downshiftActive || finalGearHoldActive ? 0.07 : 0;
  const engineLevel = 0.08 + (rpm / 8500) * 0.16 + throttle * 0.08 + downshiftBite;

  engineFilter.frequency.setTargetAtTime(420 + rpm / 4.7, now, 0.045);
  engineGain.gain.setTargetAtTime(engineLevel, now, 0.035);

  // Turbo is delayed so idle does not sound like boost.
  const spoolLoad = Math.max(throttle, downshiftActive ? 0.48 : 0);
  const spoolFactor = clamp((rpm - 3800) / 3600, 0, 1) * spoolLoad;

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

function triggerOverrunPops(strength = 1) {
  if (!audioEnabled || !engineRunning) return;

  const count = driveMode ? 3 : 2;

  for (let i = 0; i < count; i += 1) {
    setTimeout(() => makePopBang(strength + Math.random() * 0.30), i * (90 + Math.random() * 60));
  }
}

function triggerGearshiftPop() {
  if (!audioEnabled || !engineRunning) return;
  makePopBang(0.45);
}

function triggerDownshiftBlip(intensity = 1) {
  if (!engineRunning) return;

  downshiftBlipUntilMs = performance.now() + 380;
  throttle = Math.max(throttle, 0.70);
  currentRpm = clamp(currentRpm + 1450 * intensity, 1600, 8200);

  if (audioEnabled) {
    makePopBang(0.78 * intensity);
    setTimeout(() => makePopBang(0.58 * intensity), 110);
  }
}

function startDownshiftSequence() {
  if (!engineRunning || !driveMode || gear <= 1) {
    triggerOverrunPops(1.0);
    return;
  }

  downshiftQueue = [];
  for (let g = gear - 1; g >= 1; g -= 1) {
    downshiftQueue.push(g);
  }

  if (!downshiftQueue.length) return;

  downshiftActive = true;
  downshiftNextMs = performance.now() + 220;

  finalGearHoldActive = false;
  finalGearHoldUntilMs = 0;
  finalGearCoastUntilMs = 0;

  triggerOverrunPops(1.0);
  updateButtonStates();
}

function processDownshiftSequence(timestamp) {
  if (!downshiftActive) return;

  if (timestamp >= downshiftNextMs && downshiftQueue.length) {
    gear = downshiftQueue.shift();

    const intensity = clamp(1 + (6 - gear) * 0.11, 1, 1.55);

    // Important: if this is the final downshift to 1st gear, force the RPM
    // directly into the 4.2K engine-braking region. This prevents the unwanted
    // 1K dip before the 4.2K hold.
    if (gear === 1) {
      currentRpm = Math.max(currentRpm, 4200);
      currentSpeed = Math.max(currentSpeed, 32);
    }

    triggerDownshiftBlip(intensity);
    triggerOverrunPops(0.95 * intensity);

    downshiftNextMs = timestamp + 620;
    updateButtonStates();
  }

  if (!downshiftQueue.length && timestamp > downshiftNextMs + 420) {
    downshiftActive = false;
    throttle = 0;

    // Hold the connected-driveline engine-braking feel first,
    // then coast smoothly to idle. No sudden 1K dip.
    finalGearHoldActive = true;
    finalGearHoldUntilMs = timestamp + 1350;
    finalGearCoastUntilMs = timestamp + 3450;

    currentRpm = Math.max(currentRpm, 4200);
    currentSpeed = Math.max(currentSpeed, 30);

    updateButtonStates();
  }
}

async function startEngine() {
  ensureAudio();
  await resumeAudioIfNeeded();

  engineRunning = true;
  audioEnabled = true;
  gear = driveMode ? 1 : 0;
  currentRpm = Math.max(currentRpm, 950);

  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(0.55, audioCtx.currentTime, 0.025);
  }

  updateButtonStates();
}

function stopEngine() {
  if (acceleratorPressed || downshiftActive || finalGearHoldActive) {
    triggerOverrunPops(0.9);
  }

  engineRunning = false;
  acceleratorPressed = false;
  driveMode = false;
  downshiftActive = false;
  downshiftQueue = [];
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

  const wasPressed = acceleratorPressed;
  acceleratorPressed = pressed;

  if (pressed) {
    downshiftActive = false;
    downshiftQueue = [];
    finalGearHoldActive = false;
    finalGearHoldUntilMs = 0;
    finalGearCoastUntilMs = 0;
  }

  if (wasPressed && !pressed) {
    if (driveMode && gear > 1) {
      startDownshiftSequence();
    } else {
      triggerOverrunPops(1.0);
    }
  }

  updateButtonStates();
}

function updateVehicleState(timestamp) {
  const dt = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 0.05) : 0.016;
  lastTimestamp = timestamp;

  processDownshiftSequence(timestamp);

  const targetThrottle = engineRunning && (acceleratorPressed || downshiftActive)
    ? (downshiftActive ? 0.55 : 1)
    : 0;

  const throttleRate = targetThrottle > throttle ? 3.1 : 4.2;
  throttle += (targetThrottle - throttle) * clamp(dt * throttleRate, 0, 1);

  if (!engineRunning) {
    currentRpm += (0 - currentRpm) * clamp(dt * 2.4, 0, 1);
    currentSpeed += (0 - currentSpeed) * clamp(dt * 2.4, 0, 1);
    setGauge(currentRpm);
    return;
  }

  if (!driveMode) {
    const targetRpm = acceleratorPressed
      ? 7600 + 260 * Math.sin(timestamp / 85)
      : 1050 + 90 * Math.sin(timestamp / 520);

    currentRpm += (targetRpm - currentRpm) * clamp(dt * (acceleratorPressed ? 5.5 : 2.2), 0, 1);
    currentSpeed += (0 - currentSpeed) * clamp(dt * 2.4, 0, 1);
  } else {
    if (gear < 1) gear = 1;

    const gearRatios = [0, 2.9, 2.1, 1.55, 1.18, 0.94, 0.78];
    const finalDrive = 36;
    const ratio = gearRatios[gear] || 1;

    if (acceleratorPressed && !downshiftActive && !finalGearHoldActive) {
      currentSpeed += (18 / gear) * throttle * dt;
      currentSpeed = clamp(currentSpeed, 0, 245);
    } else {
      currentSpeed -= finalGearHoldActive ? 8 * dt : 14 * dt;
      currentSpeed = Math.max(0, currentSpeed);
    }

    const rollingRpm = 900 + currentSpeed * ratio * finalDrive;

    let targetRpm = acceleratorPressed
      ? clamp(rollingRpm + throttle * 1500, 1200, 8200)
      : clamp(rollingRpm, 950, 4200);

    if (downshiftActive && timestamp < downshiftBlipUntilMs) {
      targetRpm = clamp(Math.max(targetRpm, currentRpm + 600), 2500, 8200);
    }

    if (!acceleratorPressed && !downshiftActive && gear <= 1 && finalGearHoldActive) {
      if (timestamp <= finalGearHoldUntilMs) {
        // Connected driveline / engine-braking mimic.
        // Hold around 4.2K RPM briefly without allowing an idle dip.
        targetRpm = 4200 + 90 * Math.sin(timestamp / 130);

        // Keep enough rolling feel during the hold phase.
        currentSpeed = Math.max(currentSpeed, 18);
      } else {
        // Smooth coast down from 4.2K to idle.
        const coastProgress = clamp(
          (timestamp - finalGearHoldUntilMs) /
            Math.max(finalGearCoastUntilMs - finalGearHoldUntilMs, 1),
          0,
          1
        );

        const idleTarget = 1050 + 70 * Math.sin(timestamp / 420);
        const coastTarget = 4200 - coastProgress * 3150;

        // During this phase, RPM must be controlled by the coast curve,
        // not by rollingRpm, otherwise it can jump back to 4.2K.
        targetRpm = Math.max(idleTarget, coastTarget);

        // Bleed vehicle speed down during the coast phase so rollingRpm
        // cannot pull the needle back up after finalGearHoldActive ends.
        currentSpeed -= 42 * dt;
        currentSpeed = Math.max(0, currentSpeed);

        // Only exit the final hold/coast state once RPM and speed are both low.
        // This prevents the 1K → 4.2K bounce.
        if (
          timestamp >= finalGearCoastUntilMs &&
          currentSpeed <= 6 &&
          currentRpm <= 1250
        ) {
          finalGearHoldActive = false;
          currentSpeed = 0;
          currentRpm = Math.max(currentRpm, 1050);
        }
      }
    }

    currentRpm += (targetRpm - currentRpm) * clamp(
      dt * (downshiftActive || finalGearHoldActive ? 5.8 : 4.0),
      0,
      1
    );

    if (acceleratorPressed && !downshiftActive && !finalGearHoldActive && currentRpm > 6900 && gear < 6 && timestamp - lastGearShiftMs > 650) {
      gear += 1;
      lastGearShiftMs = timestamp;
      currentRpm -= 2100;
      triggerGearshiftPop();
      updateButtonStates();
    }

    if (!acceleratorPressed && !downshiftActive && !finalGearHoldActive && currentSpeed < 9) {
      gear = 1;
      updateButtonStates();
    }

    if (currentRpm > 3900 && throttle > 0.65 && timestamp - lastSpoolPopMs > 1800) {
      lastSpoolPopMs = timestamp;
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
  // Keep hover free-rev behavior in Neutral mode only.
  gaugeCard.addEventListener("mouseenter", () => {
    if (engineRunning && !driveMode && !acceleratorPressed) setAcceleratorPressed(true);
  });

  gaugeCard.addEventListener("mouseleave", () => {
    if (engineRunning && !driveMode && acceleratorPressed) setAcceleratorPressed(false);
  });
}

// Mobile browsers often suspend WebAudio after screen lock/backgrounding.
// This resumes existing audio only after the page becomes active again.
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden && audioEnabled && audioCtx) {
    await resumeAudioIfNeeded();
  }
});

function animationLoop(timestamp) {
  updateVehicleState(timestamp);
  requestAnimationFrame(animationLoop);
}

updateButtonStates();
requestAnimationFrame(animationLoop);


/* Street / Track mode toggle - no engine rumble */
const modeToggleBtn = document.getElementById("modeToggleBtn");

function updateModeToggleLabel(isTrack) {
  if (!modeToggleBtn) return;
  modeToggleBtn.textContent = isTrack ? "Street Mode" : "Track Mode";
  modeToggleBtn.setAttribute("aria-label", isTrack ? "Switch to Street Mode" : "Switch to Track Mode");
  modeToggleBtn.setAttribute("title", isTrack ? "Switch to Street Mode" : "Switch to Track Mode");
}

function applyThemeMode(mode) {
  const isTrack = mode === "track";
  document.body.classList.toggle("track-mode", isTrack);
  updateModeToggleLabel(isTrack);

  try {
    localStorage.setItem("portfolioThemeMode", mode);
  } catch (e) {}
}

if (modeToggleBtn) {
  modeToggleBtn.addEventListener("click", () => {
    const isTrack = document.body.classList.contains("track-mode");
    applyThemeMode(isTrack ? "street" : "track");
  });
}

try {
  const savedMode = localStorage.getItem("portfolioThemeMode");
  applyThemeMode(savedMode === "track" ? "track" : "street");
} catch (e) {
  applyThemeMode("street");
}
