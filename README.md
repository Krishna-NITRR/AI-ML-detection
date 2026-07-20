# KHAAN NETRA

PPE compliance monitoring for underground coal mine entry points. Camera at the gate, YOLOv8 in the browser, score on screen.

Built by **Wisdom Riders**. This is Phase 1 (CV + Dashboard).

---

## What it does

Workers walk up to a mine entry gate. A webcam feed runs through a YOLOv8 model (exported to TensorFlow.js) that checks for helmet, vest, boots, self-rescuer, and gas detector. Each item has a point value. Score too low? Entry denied, supervisor gets an alert.

Everything runs client-side. No server needed. Data lives in IndexedDB. Works offline after the first load.

### What's here

- YOLOv8 inference running in-browser via TensorFlow.js
- Offline-first PWA (service worker caches the app shell + model weights)
- IndexedDB for all data: workers, scan logs, alerts
- RFID-ready identification module (schema and interface are in place, just needs hardware)

### What's not here yet (Phase 2)

- RFID handheld scanner integration
- PPE logging station (UID tag assignment)
- Server-side sync

---

## Getting started

Serve the directory. Any static server works:

```bash
# Python
cd khaan-netra && python -m http.server 8080

# Node
npx serve khaan-netra
```

Open `http://localhost:8080` in Chrome or Edge. Allow camera access when it asks. The YOLOv8 model loads on first visit and gets cached by the service worker after that.

> **Note:** `file://` won't work. The service worker needs HTTP.

---

## How the CV works

We trained a YOLOv8n model on a construction PPE dataset using `ultralytics`, then exported it to TFJS format. The model sits in `models/ppe-detector/` and `cv-scanner.js` loads it with `tf.loadGraphModel()`.

Detection classes include Helmet, Vest, Person, and the "missing" variants (NO-Hardhat, NO-Safety Vest). The model runs at whatever frame rate TF.js can manage on the client hardware, usually 10-20 FPS on a decent laptop.

### Training (if you want to retrain)

```bash
pip install ultralytics

# Construction-PPE dataset, auto-downloads (~178MB, 1416 images)
yolo detect train data=construction-ppe.yaml model=yolov8n.pt epochs=25 imgsz=640

# Export to TF.js
yolo export model=runs/detect/train/weights/best.pt format=tfjs
```

Drop the exported files into `models/ppe-detector/` and you're set.

Other datasets worth trying:
- `snehilsanyal/Construction-Site-Safety-PPE-Detection` (Kaggle, 2801 images)
- `ciber-lab/pictor-ppe` (YOLOv3, worker+hat+vest)
- `ahmadmughees/SH17dataset` (8099 images, 17 classes)

---

## Scoring

| PPE Item | Points | Essential |
|----------|--------|-----------|
| Helmet | 30 | Yes |
| Safety Vest | 25 | Yes |
| Safety Boots | 25 | Yes |
| Self-Rescuer | 10 | No |
| Gas Detector | 10 | No |
| **Total** | **100** | |

- Below 30%: **ENTRY DENIED** (red state, instant alert, supervisor notified)
- 30% and above: entry allowed, logged normally
- 30 to 49% gets a warning alert (borderline)

---

## Project structure

```
khaan-netra/
├── index.html              # Single-page app, all views
├── manifest.json           # PWA manifest
├── service-worker.js       # Offline cache (app shell + model weights)
├── css/
│   ├── index.css           # Design tokens, reset, layout
│   ├── dashboard.css       # Dashboard grid, stat cards, charts
│   └── cv-scanner.css      # Scanner UI, camera feed, PPE checklist
├── js/
│   ├── app.js              # SPA router, view switching, clock
│   ├── cv-scanner.js       # Webcam + YOLOv8 inference + NMS post-processing
│   ├── dashboard.js        # Stats, Chart.js trend line, tables, leaderboard
│   ├── data-store.js       # IndexedDB wrapper (workers, scanLogs, alerts)
│   ├── compliance.js       # Scoring formula + alert generation
│   ├── identification.js   # Worker ID source (manual entry now, RFID later)
│   └── alerts.js           # Toast notifications, audio cues, alert logging
├── lib/                    # Vendored (no CDN dependency)
│   ├── tf.min.js           # TensorFlow.js 4.22.0
│   └── chart.umd.min.js   # Chart.js 4.4.7
└── models/
    └── ppe-detector/       # YOLOv8 TFJS model weights
```

---

## RFID integration (Phase 2 notes)

The code's already set up for this. Here's how it works:

### The identification interface

`identification.js` has one contract:

```js
IdentificationSource.getWorker() → Promise<{
  workerId: string,   // e.g. "MKR-0041"
  name:     string,   // e.g. "Rajesh Kumar"
  source:   "manual" | "rfid"
}>
```

`cv-scanner.js` only calls this interface. It doesn't touch the input form directly.

### Hooking up a reader

**USB-HID readers** (keyboard-wedge type): There's already a `BurstDetector` in the manual entry field that watches for fast keystroke bursts (<50ms apart). Most HID readers just "type" the UID and hit Enter. The burst detector catches that and auto-submits. Plug in the reader and it should just work, no code changes.

**Serial/Bluetooth readers**: Use `navigator.serial` or `navigator.bluetooth` to read the UID, then resolve the Promise with `{workerId, name, source: 'rfid'}`. Add a new class in `identification.js` and update `createSource()` to pick it.

### Schema

IndexedDB already has the fields:
- `workers.rfidTag` (nullable)
- `scanLogs.identificationMethod` (`"manual"` or `"rfid"`)

No migration needed when RFID goes live.

### PPE tag scanning

Separate from worker ID. Each PPE item could have its own RFID tag. This'd be a new module (`js/rfid-scanner.js`) that scans each item, verifies UIDs server-side, and feeds results into the compliance scoring alongside the CV detections.

---

## Data export

Dashboard has CSV and JSON export buttons. Covers:
- Worker registry (ID, name, RFID tag)
- Scan logs (worker, timestamp, detections, score, verdict)
- Alerts (timestamp, type, worker, message)

---

## Testing offline

1. Load the app fully in Chrome (let the model download)
2. DevTools, then Application, then Service Workers. Check it's registered
3. Network tab, tick "Offline"
4. Reload. Dashboard, scanner, inference, all should work
5. Or just turn off WiFi

---

## Tech stack

| What | How |
|------|-----|
| Inference | TensorFlow.js + YOLOv8 (custom trained) |
| UI | Vanilla HTML/CSS/JS, no framework |
| Storage | IndexedDB |
| Charts | Chart.js 4.4.7 |
| Offline | Service Worker + Cache API (PWA) |
| Runs where | Entirely in the browser, no backend |

---

## License

Hackathon project. See the Wisdom Riders KHAAN NETRA docs for full context.
