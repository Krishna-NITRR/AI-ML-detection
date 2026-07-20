# KHAAN NETRA

**Smart PPE Compliance Monitoring & Reporting System for Underground Coal Mine Entry Points**

Built by **Wisdom Riders** — Phase 1: Computer Vision + Dashboard

---

## What This Is

KHAAN NETRA uses computer vision at mine entry gates to detect whether workers are wearing required PPE (helmet, vest, boots, self-rescuer, gas detector) before entering underground operations. It generates a compliance score, logs all scans to a local database, and provides a real-time monitoring dashboard for mine safety officers.

### Current Status: Phase 1 (CV + Dashboard)

- **Real inference** using a custom-trained YOLOv8 model (TensorFlow.js) for PPE item classification
- **Offline-first PWA** — works without network after first load
- **IndexedDB** storage — all data stays on-device
- **RFID-ready architecture** — pluggable identification module, schema includes RFID fields

### What's NOT Included Yet (Phase 2)

- RFID handheld scanner hardware integration
- PPE logging station (UID tag assignment)
- Server-side data sync

---

## Quick Start

1. Serve the `khaan-netra/` directory with any static HTTP server:
   ```bash
   # Python
   cd khaan-netra && python -m http.server 8080

   # Node.js
   npx serve khaan-netra

   # Or open index.html directly (service worker requires HTTP, not file://)
   ```
2. Open `http://localhost:8080` in Chrome/Edge
3. Grant camera permission when prompted
4. The YOLOv8 model downloads on first load, then is cached offline

---

## Computer Vision Approach

### Current Implementation

The system uses a custom-trained **YOLOv8** model exported to TensorFlow.js to detect PPE items directly in the browser. This is **real inference** running entirely on the edge.

The model is trained to detect classes such as:
- **Helmet** (Hardhat)
- **Vest** (Safety Vest)
- **Person**
- Missing PPE classes (NO-Hardhat, NO-Safety Vest)

### How it was trained

The model was trained using the `ultralytics` package on a PPE detection dataset:

```bash
pip install ultralytics

# Train on Construction-PPE dataset (auto-downloads, ~178MB, 1416 images)
yolo detect train data=construction-ppe.yaml model=yolov8n.pt epochs=25 imgsz=640

# Export to TensorFlow.js format
yolo export model=runs/detect/train/weights/best.pt format=tfjs
```

The exported model files are placed in `models/ppe-detector/` and loaded by `cv-scanner.js` via `tf.loadGraphModel()`.

Alternative datasets for future improvements:
- `snehilsanyal/Construction-Site-Safety-PPE-Detection` (Kaggle, 2801 images)
- `ciber-lab/pictor-ppe` (YOLOv3, worker+hat+vest)
- `ahmadmughees/SH17dataset` (8099 images, 17 classes)

---

## Scoring Formula

| PPE Item | Points | Essential |
|----------|--------|-----------|
| Helmet | 30 | Yes |
| Safety Vest | 25 | Yes |
| Safety Boots | 25 | Yes |
| Self-Rescuer | 10 | No |
| Gas Detector | 10 | No |
| **Total** | **100** | |

- **Score < 30%** → ENTRY DENIED (red state, instant alert, supervisor notified)
- **Score ≥ 30%** → ENTRY ALLOWED (logged normally)
- Borderline scores (30–49%) trigger warning alerts

---

## Architecture

```
khaan-netra/
├── index.html              # SPA with all views
├── manifest.json           # PWA manifest
├── service-worker.js       # Offline cache (app shell + model weights)
├── css/
│   ├── index.css           # Design tokens, reset, layout primitives
│   ├── dashboard.css       # Dashboard grid, stat cards, chart
│   └── cv-scanner.css      # Scanner station, camera feed, PPE checklist
├── js/
│   ├── app.js              # SPA router, view lifecycle, clock
│   ├── cv-scanner.js       # Webcam, COCO-SSD inference, PPE heuristics
│   ├── dashboard.js        # Stats, Chart.js trend, tables, leaderboard
│   ├── data-store.js       # IndexedDB wrapper (workers, scanLogs, alerts)
│   ├── compliance.js       # Scoring engine (formula + alert generation)
│   ├── identification.js   # Pluggable ID source (ManualEntry + RFID-ready)
│   └── alerts.js           # Toast notifications, audio cues, alert logging
├── lib/                    # Vendored libraries (offline-safe)
│   ├── tf.min.js           # TensorFlow.js 4.22.0
│   └── chart.umd.min.js   # Chart.js 4.4.7
└── models/
    └── ppe-detector/       # Trained TFJS YOLOv8 model weights
```

---

## Phase 2 Integration Guide — RFID

The codebase is designed for zero-rearchitecture RFID integration.

### Pluggable Identification Interface

`identification.js` exports a single contract:

```js
IdentificationSource.getWorker() → Promise<{
  workerId: string,   // e.g. "MKR-0041"
  name:     string,   // e.g. "Rajesh Kumar"
  source:   "manual" | "rfid"
}>
```

`cv-scanner.js` calls **only this interface** — it never references the input form directly.

### Adding an `RFIDSource`

1. Create a new class implementing `getWorker()` in `identification.js`
2. For **USB-HID readers** (most common): The manual entry field already includes a `BurstDetector` that detects fast character bursts (<50ms between keystrokes) — this is how HID keyboard-wedge RFID readers work. When real hardware is plugged in, it'll "type" the tag UID into the focused input and press Enter. The burst detector catches this and auto-submits. **Zero code changes needed** for many readers.
3. For **serial/Bluetooth readers**: Use `navigator.serial` or `navigator.bluetooth` Web APIs to connect, read the UID, and resolve the Promise with `{workerId, name, source: 'rfid'}`.
4. Update `IdentificationSource.createSource()` to select the active source based on connected hardware.

### Schema Readiness

The IndexedDB schema already includes:
- `workers.rfidTag` (nullable) — set when RFID tag is assigned to a worker
- `scanLogs.identificationMethod` — records `"manual"` or `"rfid"` per scan
- No schema migration needed when RFID goes live

### RFID PPE Tag Scanning (Separate from Worker ID)

The PDF describes a separate RFID flow for scanning PPE items (each PPE has an RFID tag). This would be a new module (`js/rfid-scanner.js`) that:
1. Prompts the operator to scan each PPE item
2. Sends scanned UIDs to the server for verification
3. Integrates with the compliance scoring as an additional data source alongside CV

---

## Data Export

The dashboard includes CSV and JSON export buttons. Exported data includes:
- Worker registry (ID, name, RFID tag)
- All scan logs (worker, timestamp, detection details, score, verdict)
- All alerts (timestamp, type, worker, message)

---

## Offline Verification

1. Open the app in Chrome, allow it to fully load (model downloads)
2. Open DevTools → Application → Service Workers → confirm registered
3. Go to Network tab → check "Offline"
4. Reload the page — everything should work: dashboard, scanner, inference
5. Or: disable WiFi / enable airplane mode and test

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Inference | TensorFlow.js + Custom YOLOv8 |
| UI | Vanilla HTML/CSS/JS (no framework) |
| Storage | IndexedDB (browser-native) |
| Charts | Chart.js 4.4.7 |
| Offline | Service Worker + Cache API (PWA) |
| Edge Compute | Runs entirely in-browser (no server) |

---

## License

Built for hackathon demonstration. See original Wisdom Riders KHAAN NETRA project documentation for full context.
