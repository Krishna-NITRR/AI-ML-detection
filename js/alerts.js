/* ============================================================
   KHAAN NETRA - Alert System
   Visual toasts, audio cues, and alert logging.
   Language: terse, operational mine-safety-desk tone.
   ============================================================ */

const ALERT_AUDIO_FREQ = {
  deny:            [440, 880, 440],   // Warning beeps
  warning:         [660],              // Single tone
  repeat_offender: [880, 880, 880],   // Triple high
};

let _audioCtx = null;

function _getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioCtx;
}

/**
 * Play a short alert beep sequence.
 */
function playAlertSound(type = 'deny') {
  try {
    const ctx   = _getAudioCtx();
    const freqs = ALERT_AUDIO_FREQ[type] || ALERT_AUDIO_FREQ.warning;
    const now   = ctx.currentTime;

    freqs.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type       = 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.12);
    });
  } catch (e) {
    // Audio not available - silent fail
  }
}

/**
 * Show a toast notification.
 * @param {'red'|'amber'|'green'} level
 * @param {string} title
 * @param {string} message
 * @param {number} duration ms
 */
function showToast(level, title, message, duration = 5000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const iconSvg = level === 'red'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    : level === 'amber'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

  const toast = document.createElement('div');
  toast.className = `toast toast--${level}`;
  toast.innerHTML = `
    <div class="toast__icon">${iconSvg}</div>
    <div class="toast__content">
      <div class="toast__title">${title}</div>
      <div class="toast__message">${message}</div>
    </div>
    <button class="toast__close" aria-label="Dismiss">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  toast.querySelector('.toast__close').addEventListener('click', () => removeToast(toast));
  container.appendChild(toast);

  // Auto-dismiss
  setTimeout(() => removeToast(toast), duration);

  // Limit visible toasts
  while (container.children.length > 4) {
    removeToast(container.firstElementChild);
  }
}

function removeToast(el) {
  if (!el || !el.parentNode) return;
  el.classList.add('toast--exit');
  setTimeout(() => el.remove(), 200);
}

/**
 * Process a scan result and trigger appropriate alerts.
 * @param {Object} scanResult from Compliance.calculateScore
 * @param {string} workerName
 * @param {string} workerId
 */
async function processScanAlerts(scanResult, workerName, workerId) {
  const { score, verdict, missingEssential } = scanResult;

  if (verdict === 'deny') {
    const msg = Compliance.generateAlertMessage(scanResult, workerName, workerId);

    // Visual toast
    showToast('red', 'ENTRY DENIED', `${workerName} (${workerId}) - ${msg}`);

    // Audio alert
    playAlertSound('deny');

    // Log to DB
    await DataStore.addAlert({
      timestamp:  Date.now(),
      type:       'deny',
      workerId,
      workerName,
      message:    msg,
      score,
    });

    // Check repeat offender
    const { isRepeat, recentDenials } = await Compliance.checkRepeatOffender(workerId);
    if (isRepeat) {
      const repeatMsg = `${recentDenials + 1} REPEAT VIOLATIONS THIS SHIFT - ${workerName} (${workerId}). Supervisor notified.`;
      showToast('red', 'REPEAT OFFENDER', repeatMsg, 8000);
      playAlertSound('repeat_offender');

      await DataStore.addAlert({
        timestamp:  Date.now(),
        type:       'repeat_offender',
        workerId,
        workerName,
        message:    repeatMsg,
        score,
      });
    }

  } else if (score < 50) {
    // Borderline - warning
    const msg = Compliance.generateAlertMessage(scanResult, workerName, workerId);
    if (msg) {
      showToast('amber', 'BORDERLINE COMPLIANCE', `${workerName} (${workerId}) - ${msg}`);
      playAlertSound('warning');

      await DataStore.addAlert({
        timestamp:  Date.now(),
        type:       'warning',
        workerId,
        workerName,
        message:    msg,
        score,
      });
    }
  }
  // Score ≥ 50 - no alert, just log normally

  // Update alert badge in nav
  _updateAlertBadge();
}

async function _updateAlertBadge() {
  const badge = document.getElementById('nav-alert-badge');
  if (!badge) return;
  const todayAlerts = (await DataStore.getRecentAlerts(100))
    .filter(a => a.timestamp > Date.now() - 12 * 3600000);
  if (todayAlerts.length > 0) {
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

window.Alerts = {
  showToast,
  playAlertSound,
  processScanAlerts,
  removeToast,
};
