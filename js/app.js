/* ============================================================
   KHAAN NETRA - App Shell / Router
   Hash-based SPA routing, view lifecycle, shift/time display.
   ============================================================ */

const VIEWS = ['dashboard', 'scanner', 'workers', 'alerts'];
let _currentView  = null;
let _idSource     = null;
let _scannerReady = false;
let _timeInterval = null;

/* ---------- Init ---------- */

document.addEventListener('DOMContentLoaded', async () => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./service-worker.js');
      console.log('[App] Service worker registered');
    } catch (e) {
      console.warn('[App] SW registration failed:', e);
    }
  }

  // Open DB and seed demo data
  await DataStore.openDB();
  await DataStore.seedDemoData();

  // Start clock
  _startClock();

  // Nav click handlers
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const view = el.dataset.nav;
      if (view && !el.classList.contains('nav-item--disabled')) {
        navigateTo(view);
      }
    });
  });

  // Export buttons
  document.getElementById('btn-export-json')?.addEventListener('click', () => DataStore.exportData('json'));
  document.getElementById('btn-export-csv')?.addEventListener('click', () => DataStore.exportData('csv'));

  // Route from hash or default to dashboard
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(VIEWS.includes(hash) ? hash : 'dashboard');
});

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  if (VIEWS.includes(hash) && hash !== _currentView) {
    navigateTo(hash);
  }
});

/* ---------- Navigation ---------- */

function navigateTo(view) {
  if (_currentView === view) return;

  // Deactivate previous
  if (_currentView) {
    _leaveView(_currentView);
  }

  _currentView = view;
  window.location.hash = view;

  // Update nav
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('nav-item--active', el.dataset.nav === view);
  });

  // Show view, hide others
  document.querySelectorAll('.view').forEach(el => {
    el.classList.toggle('view--active', el.id === `view-${view}`);
  });

  // Enter new view
  _enterView(view);
}

async function _enterView(view) {
  switch (view) {
    case 'dashboard':
      await Dashboard.initDashboard();
      break;

    case 'scanner':
      await _initScanner();
      break;

    case 'workers':
      await Dashboard.renderWorkersPage();
      break;

    case 'alerts':
      await Dashboard.renderAlertsPage();
      break;
  }
}

function _leaveView(view) {
  if (view === 'scanner') {
    // Don't stop camera when navigating away - keep model loaded
    // Just pause the detection loop to save CPU
    CVScanner.stopDetectionLoop();
  }
  if (view === 'dashboard') {
    // Dashboard will re-render on next visit
  }
}

/* ---------- Scanner init ---------- */

async function _initScanner() {
  const statusPanel = document.getElementById('scanner-status-content');
  const resultPanel = document.getElementById('scanner-result-content');
  const cameraPlaceholder = document.getElementById('camera-placeholder');
  const modelOverlay = document.getElementById('model-loading-overlay');
  const videoEl   = document.getElementById('scanner-video');
  const canvasEl  = document.getElementById('scanner-canvas');

  // Mount identification source
  if (!_idSource) {
    _idSource = IdentificationSource.createSource();
    const formContainer = document.getElementById('scanner-id-form');
    _idSource.mount(formContainer);
  }

  // Load model if not loaded
  if (!CVScanner.isModelLoaded()) {
    if (modelOverlay) modelOverlay.style.display = 'flex';
    if (cameraPlaceholder) cameraPlaceholder.style.display = 'none';

    const progressBar = document.getElementById('model-progress-bar');
    try {
      await CVScanner.loadModel((pct) => {
        if (progressBar) progressBar.style.width = pct + '%';
      });
    } catch (err) {
      console.error('[App] Model load failed:', err);
      if (modelOverlay) {
        modelOverlay.querySelector('.model-loading-overlay__text').textContent =
          'MODEL LOAD FAILED - CHECK NETWORK CONNECTION FOR FIRST LOAD';
      }
      return;
    }
  }

  // Init camera if not running
  if (!CVScanner.isRunning()) {
    if (modelOverlay) modelOverlay.style.display = 'flex';
    modelOverlay.querySelector('.model-loading-overlay__text').textContent = 'INITIALIZING CAMERA...';

    try {
      await CVScanner.initCamera(videoEl, canvasEl);
      if (cameraPlaceholder) cameraPlaceholder.style.display = 'none';
      if (modelOverlay) modelOverlay.style.display = 'none';
      await CVScanner.startDetectionLoop();
      _scannerReady = true;
    } catch (err) {
      console.error('[App] Camera init failed:', err);
      if (modelOverlay) {
        modelOverlay.querySelector('.model-loading-overlay__text').textContent =
          'CAMERA ACCESS DENIED - GRANT PERMISSION AND RELOAD';
      }
      return;
    }
  } else {
    if (modelOverlay) modelOverlay.style.display = 'none';
    if (cameraPlaceholder) cameraPlaceholder.style.display = 'none';
    await CVScanner.startDetectionLoop();
  }

  // Reset result panel
  _resetScanResult();

  // Wait for identification, then scan
  _waitForScan();
}

async function _waitForScan() {
  if (!_idSource) return;

  _idSource.reset();
  _resetScanResult();
  _resetPPEChecklist();

  const identity = await _idSource.getWorker();

  // Lock form, start scan
  _idSource.lock();

  const resultPanel = document.getElementById('scanner-result-content');
  if (resultPanel) {
    resultPanel.innerHTML = `
      <div class="score-display">
        <div class="score-display__label">SCANNING IN PROGRESS</div>
        <div style="margin-top:var(--sp-3)">
          <div class="model-loading-overlay__spinner" style="margin:0 auto"></div>
        </div>
      </div>`;
  }

  try {
    const result = await CVScanner.performScan(identity);
    _showScanResult(result);
  } catch (err) {
    console.error('[App] Scan failed:', err);
    if (resultPanel) {
      resultPanel.innerHTML = `
        <div class="result-card">
          <div class="result-card__verdict text-red">SCAN ERROR</div>
          <div class="result-card__message">${err.message}</div>
          <div class="result-card__actions">
            <button class="btn btn--outline" id="btn-retry-scan">Retry</button>
          </div>
        </div>`;
      document.getElementById('btn-retry-scan')?.addEventListener('click', () => {
        _idSource.unlock();
        _waitForScan();
      });
    }
  }
}

function _showScanResult(result) {
  const resultPanel = document.getElementById('scanner-result-content');
  if (!resultPanel) return;

  const scoreClass = Compliance.scoreColor(result.score);
  const isAllow = result.verdict === 'allow';

  // Update PPE checklist with final values
  for (const det of result.detections) {
    const el = document.getElementById(`ppe-status-${det.item.toLowerCase().replace(/\s+/g, '-')}`);
    if (!el) continue;
    el.classList.remove('ppe-check-item--detected', 'ppe-check-item--missing', 'ppe-check-item--pending');
    el.classList.add(det.detected ? 'ppe-check-item--detected' : 'ppe-check-item--missing');
    const confEl = el.querySelector('.ppe-check-item__confidence');
    if (confEl) confEl.textContent = `${det.confidence}%`;
    const statusIcon = el.querySelector('.ppe-check-item__status-icon');
    if (statusIcon) {
      statusIcon.innerHTML = det.detected
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-green"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-red"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    }
  }

  resultPanel.innerHTML = `
    <div class="score-display">
      <div class="score-display__value text-${scoreClass}">${result.score}%</div>
      <div class="score-display__label">COMPLIANCE SCORE</div>
      <div class="score-display__bar">
        <div class="score-display__bar-fill" style="width:${result.score}%;background:var(--${scoreClass})"></div>
      </div>
    </div>
    <div class="result-card" style="border-top:1px solid var(--border-subtle);margin-top:var(--sp-3);padding-top:var(--sp-3)">
      <div class="result-card__verdict result-card__verdict--${result.verdict}">
        ${isAllow ? 'ENTRY ALLOWED' : 'ENTRY DENIED'}
      </div>
      <div class="result-card__message">
        ${isAllow
          ? `${result.workerName} (${result.workerId}) cleared for mine entry.`
          : `${result.workerName} (${result.workerId}) - ${result.missingEssential.map(m => m.toUpperCase()).join(', ')} NOT DETECTED.`}
      </div>
      <div class="result-card__actions">
        <button class="btn btn--primary" id="btn-next-scan">Next Worker</button>
      </div>
    </div>`;

  // Score bar animation
  setTimeout(() => {
    const fill = resultPanel.querySelector('.score-display__bar-fill');
    if (fill) fill.style.width = result.score + '%';
  }, 50);

  document.getElementById('btn-next-scan')?.addEventListener('click', () => {
    _idSource.unlock();
    _waitForScan();
  });

  // Refresh dashboard data in background
  Dashboard.refreshDashboard().catch(() => {});
}

function _resetScanResult() {
  const resultPanel = document.getElementById('scanner-result-content');
  if (resultPanel) {
    resultPanel.innerHTML = `
      <div class="score-display">
        <div class="score-display__value text-dim">--</div>
        <div class="score-display__label">AWAITING SCAN</div>
        <div class="score-display__bar">
          <div class="score-display__bar-fill" style="width:0%"></div>
        </div>
      </div>`;
  }
}

function _resetPPEChecklist() {
  Compliance.PPE_ITEMS.forEach(ppe => {
    const el = document.getElementById(`ppe-status-${ppe.item.toLowerCase().replace(/\s+/g, '-')}`);
    if (!el) return;
    el.classList.remove('ppe-check-item--detected', 'ppe-check-item--missing');
    el.classList.add('ppe-check-item--pending');
    const confEl = el.querySelector('.ppe-check-item__confidence');
    if (confEl) confEl.textContent = '--';
    const statusIcon = el.querySelector('.ppe-check-item__status-icon');
    if (statusIcon) {
      statusIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-dim"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    }
  });
}

/* ---------- Clock / shift ---------- */

function _startClock() {
  const timeEl  = document.getElementById('header-time');
  const shiftEl = document.getElementById('header-shift');

  const update = () => {
    const now  = new Date();
    const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    if (timeEl) timeEl.textContent = time;

    // Shift determination: A = 06:00-14:00, B = 14:00-22:00, C = 22:00-06:00
    const h = now.getHours();
    let shift = 'C';
    if (h >= 6 && h < 14)  shift = 'A';
    if (h >= 14 && h < 22) shift = 'B';
    if (shiftEl) shiftEl.textContent = `SHIFT ${shift}`;
  };

  update();
  _timeInterval = setInterval(update, 1000);
}

/* ---------- Exposed for inline handlers ---------- */
window.App = {
  navigateTo,
};
