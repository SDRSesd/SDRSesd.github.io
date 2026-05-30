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

if (gaugeCard && needleWrap && rpmValue) {
  let mode = "idle";
  let burstUntil = 0;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function rpmToAngle(rpm) {
    const limited = clamp(rpm, 0, 8500);
    return -120 + (limited / 8500) * 240;
  }

  function setGauge(rpm) {
    const angle = rpmToAngle(rpm);
    needleWrap.style.transform = `rotate(${angle}deg)`;
    rpmValue.textContent = Math.round(rpm).toString();
    gaugeCard.classList.toggle("is-redline", rpm >= 7200);
  }

  function triggerBurst() {
    mode = "burst";
    burstUntil = performance.now() + 1600;
  }

  gaugeCard.addEventListener("mouseenter", () => {
    mode = "hover";
  });

  gaugeCard.addEventListener("mouseleave", () => {
    mode = "idle";
  });

  gaugeCard.addEventListener("touchstart", () => {
    triggerBurst();
  }, { passive: true });

  gaugeCard.addEventListener("click", () => {
    triggerBurst();
  });

  function animateGauge(timestamp) {
    let rpm = 3200;

    if (mode === "hover") {
      rpm = 7750 + 220 * Math.sin(timestamp / 95);
    } else if (mode === "burst") {
      if (timestamp >= burstUntil) {
        mode = "idle";
      } else {
        const progress = 1 - ((burstUntil - timestamp) / 1600);
        const rise = progress < 0.35
          ? 3200 + (progress / 0.35) * 5000
          : 8200 - ((progress - 0.35) / 0.65) * 500;
        rpm = rise + 180 * Math.sin(timestamp / 90);
      }
    }

    if (mode === "idle") {
      rpm = 3150 + 650 * Math.sin(timestamp / 650) + 180 * Math.sin(timestamp / 2100);
    }

    setGauge(rpm);
    requestAnimationFrame(animateGauge);
  }

  requestAnimationFrame(animateGauge);
}
