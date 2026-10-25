/* ══════════════════════════════════════════════════════════════════
   DHAVLI · धवली — 3.0-SECOND CINEMATIC INTRO ENGINE
   Pure black screen, 3s choreography, seamless background prep
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function launchDhavliIntro() {
    var loader = document.getElementById('dhavli-loader');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'dhavli-loader';
      loader.setAttribute('role', 'status');
      loader.setAttribute('aria-label', 'Initializing Dhavli');
      loader.innerHTML = [
        '<div class="dl-crosshair tl"></div><div class="dl-crosshair tr"></div>',
        '<div class="dl-crosshair bl"></div><div class="dl-crosshair br"></div>',
        '<div class="dl-motes">',
        '  <span class="dl-mote" style="top:35%;left:25%;width:2px;height:2px;background:#00f0ff;animation-delay:0.3s"></span>',
        '  <span class="dl-mote" style="top:60%;left:75%;width:3px;height:3px;background:#ffaa33;animation-delay:0.8s"></span>',
        '  <span class="dl-mote" style="top:40%;left:80%;width:2px;height:2px;background:#ffffff;animation-delay:1.2s"></span>',
        '  <span class="dl-mote" style="top:65%;left:20%;width:2.5px;height:2.5px;background:#00f0ff;animation-delay:0.6s"></span>',
        '</div>',
        '<div class="dl-stage">',
        '  <div class="dl-soundwave-wrap">',
        '    <svg class="dl-soundwave-svg" viewBox="0 0 380 48" fill="none">',
        '      <path class="dl-soundwave-path" d="M 0,24 Q 45,24 90,24 Q 115,8 140,24 Q 165,40 190,24 Q 205,4 220,24 Q 235,44 250,24 Q 275,24 380,24" />',
        '    </svg>',
        '    <div class="dl-anamorphic-streak"></div>',
        '  </div>',
        '  <div class="dl-typography">',
        '    <div class="dl-hindi-text">धवली</div>',
        '    <div class="dl-english-text">DHAVLI</div>',
        '    <div class="dl-designation-text">AUTONOMOUS ACOUSTIC INTELLIGENCE GRID</div>',
        '  </div>',
        '  <div class="dl-telemetry-panel">',
        '    <span class="dl-telemetry-pulse"></span>',
        '    <span class="dl-telemetry-status" id="dl-status-msg">INITIALIZING 16.0 kHz ACOUSTIC SENSORS</span>',
        '    <span class="dl-telemetry-value" id="dl-status-metric">[ 380ms ]</span>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.insertBefore(loader, document.body.firstChild);
    }

    var statusMsg = document.getElementById('dl-status-msg');
    var statusMetric = document.getElementById('dl-status-metric');

    // Precision 3-Second Choreography Schedule
    // Step 1: 0.9s - Frequency lock
    var step1 = setTimeout(function () {
      if (statusMsg) statusMsg.textContent = 'CALIBRATING STEREO TDOA AZIMUTH';
      if (statusMetric) statusMetric.textContent = '[ 142.8° ]';
    }, 950);

    // Step 2: 1.9s - Sensor grid online
    var step2 = setTimeout(function () {
      if (statusMsg) statusMsg.textContent = 'NEURAL FORENSIC ENGINE READY';
      if (statusMetric) statusMetric.textContent = '[ 100% ]';
    }, 1950);

    // Step 3: Exactly 3.0 Seconds - Dissolve pitch-black curtain into loaded website
    var finished = false;
    function revealWebsite() {
      if (finished) return;
      finished = true;
      clearTimeout(step1);
      clearTimeout(step2);

      // Begin cinematic iris blur & scale dissolve
      loader.classList.add('dl-fade-out');

      // Unmount after transition completes
      setTimeout(function () {
        if (loader && loader.parentNode) {
          loader.parentNode.removeChild(loader);
        }
      }, 700);
    }

    // Play for 3 full seconds (3000ms)
    setTimeout(revealWebsite, 3000);

    // Immediate skip on user click / tap / keydown
    loader.addEventListener('click', revealWebsite);
    window.addEventListener('keydown', revealWebsite, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', launchDhavliIntro);
  } else {
    launchDhavliIntro();
  }
})();
