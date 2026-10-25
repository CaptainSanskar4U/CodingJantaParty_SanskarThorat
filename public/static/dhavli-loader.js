/* ══════════════════════════════════════════════════════════════════
   DHAVLI · धवली — ACOUSTIC LOADER ENGINE
   Ultra-smooth, zero-lag lifecycle management
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function initDhavliLoader() {
    var loader = document.getElementById('dhavli-loader');
    if (!loader) {
      // Auto-inject if not already present in HTML
      loader = document.createElement('div');
      loader.id = 'dhavli-loader';
      loader.setAttribute('role', 'status');
      loader.setAttribute('aria-label', 'Loading Dhavli');
      loader.innerHTML = [
        '<div class="dl-backdrop"></div>',
        '<div class="dl-content">',
        '  <div class="dl-frame"><span class="dl-c tl"></span><span class="dl-c tr"></span><span class="dl-c bl"></span><span class="dl-c br"></span></div>',
        '  <div class="dl-wave-wrap">',
        '    <svg class="dl-wave" viewBox="0 0 360 48" fill="none">',
        '      <path class="dl-line" d="M 0,24 Q 45,24 90,24 Q 115,8 140,24 Q 165,40 190,24 Q 205,4 220,24 Q 235,44 250,24 Q 275,24 360,24" />',
        '    </svg>',
        '    <div class="dl-scan-beam"></div>',
        '  </div>',
        '  <div class="dl-type">',
        '    <div class="dl-hindi">धवली</div>',
        '    <div class="dl-title">DHAVLI</div>',
        '    <div class="dl-sub">ACOUSTIC FORENSIC INTELLIGENCE</div>',
        '  </div>',
        '  <div class="dl-telemetry">',
        '    <span class="dl-pulse"></span>',
        '    <span class="dl-status" id="dl-status-text">INITIALIZING 16.0 kHz MESH</span>',
        '    <span class="dl-val" id="dl-status-val">[ 98.4% ]</span>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.insertBefore(loader, document.body.firstChild);
    }

    var statusText = document.getElementById('dl-status-text');
    var statusVal = document.getElementById('dl-status-val');

    // Smooth telemetry text progression
    var t1 = setTimeout(function () {
      if (statusText) statusText.textContent = 'CALIBRATING STEREO AZIMUTH...';
      if (statusVal) statusVal.textContent = '[ 99.6% ]';
    }, 450);

    var t2 = setTimeout(function () {
      if (statusText) statusText.textContent = 'ACOUSTIC GRID CALIBRATED';
      if (statusVal) statusVal.textContent = '[ READY ]';
    }, 900);

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(t1);
      clearTimeout(t2);
      loader.classList.add('dl-fade-out');
      setTimeout(function () {
        if (loader && loader.parentNode) {
          loader.parentNode.removeChild(loader);
        }
      }, 550);
    }

    // Dismiss on load or after smooth 1.25s duration
    window.addEventListener('load', function () {
      setTimeout(dismiss, 600);
    });

    // Fallback maximum duration (1.35s) so it never hangs
    setTimeout(dismiss, 1350);

    // Instant bypass on user interaction
    loader.addEventListener('click', dismiss);
    window.addEventListener('keydown', dismiss, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDhavliLoader);
  } else {
    initDhavliLoader();
  }
})();
