
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
const rpmNeedleWrap = document.getElementById("rpmNeedleWrap");
const speedNeedleWrap = document.getElementById("speedNeedleWrap");
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

const idleAudio = document.getElementById("idleAudio");
const spoolAudio = document.getElementById("spoolAudio");
const popsAudio = document.getElementById("popsAudio");
const blipAudio = document.getElementById("blipAudio");

let hoverRev = false;
let launchStart = null;
let blipStart = null;
let audioEnabled = false;
let lastSpoolTrigger = 0;
let lastPopsTrigger = 0;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function rpmToAngle(rpm) {
  const limited = clamp(rpm, 0, 8500);
  return -120 + (limited / 8500) * 240;
}

function speedToAngle(speed) {
  const limited = clamp(speed, 0, 240);
  return -120 + (limited / 240) * 240;
}

function formatSpeed(speed) {
  return String(Math.round(speed)).padStart(3, "0");
}

function safePlay(audioEl, reset = false, volume = null) {
  if (!audioEnabled || !audioEl) return;
  try {
    if (reset) audioEl.currentTime = 0;
    if (volume !== null) audioEl.volume = volume;
    audioEl.play().catch(() => {});
  } catch (e) {}
}

function safePause(audioEl) {
  if (!audioEl) return;
  try { audioEl.pause(); } catch (e) {}
}

function enableAudio() {
  audioEnabled = true;
  if (audioToggle) {
    audioToggle.classList.add("is-active");
    audioToggle.textContent = "Performance Audio On";
  }
  if (idleAudio) {
    idleAudio.volume = 0.35;
    idleAudio.loop = true;
    safePlay(idleAudio, false, 0.35);
  }
}

function updateAudio(state, timestamp) {
  if (!audioEnabled) return;

  // Idle volume follows rpm lightly
  if (idleAudio) {
    const v = state.launch ? 0.22 : clamp(0.22 + state.rpm / 12000, 0.18, 0.48);
    idleAudio.volume = v;
    idleAudio.playbackRate = clamp(0.88 + state.rpm / 8000, 0.85, 1.45);
  }

  // Turbo spool when boost rises and RPM high
  if (state.rpm > 3600 && state.boost > 0.45 && timestamp - lastSpoolTrigger > 1400) {
    safePlay(spoolAudio, true, clamp(0.25 + state.boost / 2.5, 0.25, 0.8));
    lastSpoolTrigger = timestamp;
  }

  // Rev-match blip audio
  if (state.label === "BLIP" && blipStart !== null) {
    const elapsed = timestamp - blipStart;
    if (elapsed < 80) {
      safePlay(blipAudio, true, 0.65);
    }
  }

  // Overrun pops after aggressive states
  if ((state.label === "FREE REV" || state.label === "SPORT") && state.rpm < 4200 && timestamp - lastPopsTrigger > 2000) {
    safePlay(popsAudio, true, 0.7);
    lastPopsTrigger = timestamp;
  }
}

function updateCluster(state, timestamp) {
  if (!gaugeCard || !rpmNeedleWrap || !speedNeedleWrap) return;

  rpmNeedleWrap.style.transform = `rotate(${rpmToAngle(state.rpm)}deg)`;
  speedNeedleWrap.style.transform = `rotate(${speedToAngle(state.speed)}deg)`;

  if (rpmValue) rpmValue.textContent = Math.round(state.rpm).toString();
  if (speedValue) speedValue.textContent = formatSpeed(state.speed);
  if (gearValue) gearValue.textContent = state.gear;
  if (clusterMode) clusterMode.textContent = state.label;
  if (boostValue) boostValue.textContent = `${state.boost.toFixed(1)} bar`;
  if (boostFill) boostFill.style.width = `${clamp((state.boost / 1.8) * 100, 0, 100)}%`;
  if (clusterNote) clusterNote.textContent = state.note;

  gaugeCard.classList.toggle("is-redline", state.highlight || state.rpm >= 7200);
  gaugeCard.classList.toggle("is-launch", !!state.launch);

  updateAudio(state, timestamp);
}

function computeIdleState(timestamp) {
  return {
    rpm: 2350 + 320 * Math.sin(timestamp / 720) + 100 * Math.sin(timestamp / 1900),
    speed: 0,
    gear: "N",
    boost: 0.1,
    label: "IDLE",
    note: "Analog cluster active • hover simulates a rolling pull • launch-control and rev-match ready",
    highlight: false,
    launch: false
  };
}

function computeHoverState(timestamp) {
  const speed = 96 + 18 * Math.sin(timestamp / 800);
  const rpm = 4300 + 1400 * Math.sin(timestamp / 520) + 300 * Math.sin(timestamp / 180);
  const gear = speed < 102 ? "3" : "4";
  const boost = 0.8 + 0.35 * (Math.sin(timestamp / 700) + 1) / 2;
  return {
    rpm,
    speed,
    gear,
    boost,
    label: "ROLLING",
    note: "Rolling pull active • speed, gear, boost and RPM now move together",
    highlight: rpm > 6500,
    launch: false
  };
}

function computeBlipState(timestamp) {
  const elapsed = timestamp - blipStart;
  if (elapsed > 950) {
    blipStart = null;
    return null;
  }

  const phase = elapsed / 950;
  const rpm = phase < 0.42
    ? 2900 + (phase / 0.42) * 2600
    : 5500 - ((phase - 0.42) / 0.58) * 2100;

  return {
    rpm,
    speed: 88,
    gear: phase < 0.34 ? "4" : "3",
    boost: 0.35,
    label: "BLIP",
    note: "Rev-match blip demo • downshift style RPM flare",
    highlight: phase < 0.45,
    launch: false
  };
}

function computeLaunchState(timestamp) {
  const elapsed = timestamp - launchStart;
  if (elapsed > 5400) {
    launchStart = null;
    safePlay(popsAudio, true, 0.72);
    return null;
  }

  if (elapsed < 850) {
    return {
      rpm: 4100 + 180 * Math.sin(timestamp / 70),
      speed: 0,
      gear: "1",
      boost: 0.7,
      label: "LAUNCH",
      note: "Launch control armed • boost building before release",
      highlight: false,
      launch: true
    };
  }

  const run = elapsed - 850;
  let gear = "1";
  let speed = 0;
  let rpm = 0;

  if (run < 1150) {
    const p = run / 1150;
    speed = 8 + p * 44;
    rpm = 4300 + p * 2800;
    gear = "1";
  } else if (run < 2250) {
    const p = (run - 1150) / 1100;
    speed = 52 + p * 40;
    rpm = 5000 + p * 2200;
    gear = "2";
  } else if (run < 3350) {
    const p = (run - 2250) / 1100;
    speed = 92 + p * 36;
    rpm = 5200 + p * 2000;
    gear = "3";
  } else {
    const p = (run - 3350) / 1200;
    speed = 128 + p * 36;
    rpm = 5400 + p * 1800;
    gear = "4";
  }

  return {
    rpm,
    speed,
    gear,
    boost: 1.2,
    label: "SPORT",
    note: "Launch-control demo active • staged acceleration with matched gear and speed",
    highlight: rpm >= 7000,
    launch: true
  };
}

if (audioToggle) {
  audioToggle.addEventListener("click", () => {
    enableAudio();
  });
}

if (launchBtn) {
  launchBtn.addEventListener("click", () => {
    launchStart = performance.now();
    blipStart = null;
    if (audioEnabled) safePlay(spoolAudio, true, 0.75);
  });
}

if (blipBtn) {
  blipBtn.addEventListener("click", () => {
    blipStart = performance.now();
    if (audioEnabled) safePlay(blipAudio, true, 0.65);
  });
}

if (gaugeCard) {
  gaugeCard.addEventListener("mouseenter", () => {
    hoverRev = true;
    if (audioEnabled) safePlay(spoolAudio, true, 0.55);
  });

  gaugeCard.addEventListener("mouseleave", () => {
    if (hoverRev && audioEnabled) safePlay(popsAudio, true, 0.7);
    hoverRev = false;
  });

  gaugeCard.addEventListener("touchstart", () => {
    hoverRev = true;
    if (audioEnabled) safePlay(spoolAudio, true, 0.55);
  }, { passive: true });
}

function animateCluster(timestamp) {
  let state = null;

  if (launchStart !== null) {
    state = computeLaunchState(timestamp);
  }

  if (!state && blipStart !== null) {
    state = computeBlipState(timestamp);
  }

  if (!state) {
    state = hoverRev ? computeHoverState(timestamp) : computeIdleState(timestamp);
  }

  updateCluster(state, timestamp);
  requestAnimationFrame(animateCluster);
}

requestAnimationFrame(animateCluster);
