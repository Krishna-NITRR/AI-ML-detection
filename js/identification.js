/* ============================================================
   KHAAN NETRA - Pluggable Identification Source
   
   Architecture: Single interface, multiple implementations.
   cv-scanner.js calls IdentificationSource.getWorker() - never
   a specific input method directly.
   
   Phase 1: ManualEntrySource  (text form)
   Phase 2: RFIDSource         (hardware reader - see README)
   
   The manual entry field is designed to ALREADY work as an RFID
   landing zone. Most USB/serial RFID readers behave as HID
   keyboard-wedge devices - they "type" the tag UID into the
   focused input, followed by Enter. We detect fast character
   bursts (< 50ms between chars, full string < 300ms) as a
   "this came from a scanner, not a keyboard" heuristic.
   ============================================================ */

/**
 * @typedef {Object} WorkerIdentity
 * @property {string} workerId
 * @property {string} name
 * @property {'manual'|'rfid'} source
 */

/* ---------- Keyboard-wedge (RFID HID) burst detector ---------- */

// Detects fast character bursts typical of barcode/RFID HID readers.
// Threshold: < 50ms between keystrokes, full input < 300ms.
// When detected, auto-submits without user pressing Enter manually.

class BurstDetector {
  constructor(inputEl, onBurst) {
    this._inputEl   = inputEl;
    this._onBurst   = onBurst;
    this._charTimes = [];
    this._buffer    = '';
    this._MAX_INTER_CHAR_MS = 50;  // Max time between chars for burst
    this._MIN_BURST_LEN     = 4;   // Minimum chars to consider burst
    this._resetTimer        = null;

    inputEl.addEventListener('keydown', this._handleKey.bind(this));
  }

  _handleKey(e) {
    const now = performance.now();

    if (e.key === 'Enter') {
      // Check if the accumulated input was a burst
      if (this._buffer.length >= this._MIN_BURST_LEN && this._isBurst()) {
        e.preventDefault();
        const uid = this._buffer.trim();
        this._reset();
        this._onBurst(uid);
        return;
      }
      this._reset();
      return;
    }

    // Printable character
    if (e.key.length === 1) {
      this._charTimes.push(now);
      this._buffer += e.key;

      // Auto-reset if too slow (human typing)
      clearTimeout(this._resetTimer);
      this._resetTimer = setTimeout(() => this._reset(), 500);
    }
  }

  _isBurst() {
    if (this._charTimes.length < this._MIN_BURST_LEN) return false;
    for (let i = 1; i < this._charTimes.length; i++) {
      if (this._charTimes[i] - this._charTimes[i - 1] > this._MAX_INTER_CHAR_MS) {
        return false;
      }
    }
    return true;
  }

  _reset() {
    this._charTimes = [];
    this._buffer    = '';
    clearTimeout(this._resetTimer);
  }

  destroy() {
    clearTimeout(this._resetTimer);
  }
}

/* ---------- ManualEntrySource (Phase 1 implementation) ---------- */

class ManualEntrySource {
  constructor() {
    this._nameInput = null;
    this._idInput   = null;
    this._burstDetector = null;
    this._resolve   = null;
  }

  /**
   * Mount the manual entry form into a container element.
   * @param {HTMLElement} container
   */
  mount(container) {
    container.innerHTML = `
      <div class="id-form-inner">
        <div class="input-group">
          <label class="input-group__label" for="worker-name">Worker Name</label>
          <input class="input-field" type="text" id="worker-name"
                 placeholder="e.g. Rajesh Kumar" autocomplete="off">
        </div>
        <div class="input-group">
          <label class="input-group__label" for="worker-id">Worker ID</label>
          <input class="input-field" type="text" id="worker-id"
                 placeholder="e.g. MKR-0041" autocomplete="off">
        </div>
        <button class="btn btn--primary" id="btn-begin-scan" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          Begin Scan
        </button>
      </div>
    `;

    this._nameInput = container.querySelector('#worker-name');
    this._idInput   = container.querySelector('#worker-id');
    this._btn       = container.querySelector('#btn-begin-scan');

    // Enable button only when both fields have input
    const checkFields = () => {
      this._btn.disabled = !(this._nameInput.value.trim() && this._idInput.value.trim());
    };
    this._nameInput.addEventListener('input', checkFields);
    this._idInput.addEventListener('input', checkFields);

    // RFID landing zone: keep ID input focused for HID scanner burst
    // When RFID hardware is plugged in, it'll type the UID here
    this._burstDetector = new BurstDetector(this._idInput, (uid) => {
      // Fast burst detected - likely from RFID reader
      this._idInput.value = uid;
      console.log('[ID] RFID burst detected:', uid);
      checkFields();
      // Auto-submit if name is already filled
      if (this._nameInput.value.trim() && this._resolve) {
        this._submit();
      }
    });

    // Submit on button click or Enter
    this._btn.addEventListener('click', () => this._submit());
    this._idInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this._btn.disabled) {
        e.preventDefault();
        this._submit();
      }
    });
    this._nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._idInput.focus();
      }
    });

    // Auto-focus the name field
    setTimeout(() => this._nameInput.focus(), 100);
  }

  _submit() {
    if (this._resolve) {
      const identity = {
        workerId: this._idInput.value.trim().toUpperCase(),
        name:     this._nameInput.value.trim(),
        source:   'manual',
      };
      this._resolve(identity);
      this._resolve = null;
    }
  }

  /**
   * Wait for the user to submit worker identity.
   * @returns {Promise<WorkerIdentity>}
   */
  getWorker() {
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  /**
   * Reset form for next scan.
   */
  reset() {
    if (this._nameInput) this._nameInput.value = '';
    if (this._idInput)   this._idInput.value = '';
    if (this._btn)       this._btn.disabled = true;
    setTimeout(() => this._nameInput && this._nameInput.focus(), 100);
  }

  /**
   * Lock form during active scan.
   */
  lock() {
    if (this._nameInput) this._nameInput.disabled = true;
    if (this._idInput)   this._idInput.disabled = true;
    if (this._btn)       this._btn.disabled = true;
  }

  /**
   * Unlock form after scan.
   */
  unlock() {
    if (this._nameInput) this._nameInput.disabled = false;
    if (this._idInput)   this._idInput.disabled = false;
  }

  destroy() {
    if (this._burstDetector) this._burstDetector.destroy();
  }
}

/* ---------- RFIDSource placeholder (Phase 2) ---------- */

// class RFIDSource {
//   constructor(readerConfig) { /* ... */ }
//   getWorker() {
//     // For USB-HID readers: handled by BurstDetector above
//     // For serial/BLE readers: use navigator.serial or navigator.bluetooth
//     // Return Promise<{workerId, name, source: 'rfid'}>
//   }
// }

/* ---------- Active source selector ---------- */

// Currently hardcoded to ManualEntrySource.
// Phase 2: swap based on connected hardware or user preference.

window.IdentificationSource = {
  ManualEntrySource,
  BurstDetector,
  // Factory method for the active source
  createSource() {
    return new ManualEntrySource();
  },
};
