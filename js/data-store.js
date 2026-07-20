/* ============================================================
   KHAAN NETRA - IndexedDB Data Store
   Thin wrapper over IndexedDB for all persistence.
   Schema designed for Phase 2 RFID integration:
     - workers.rfidTag column (nullable)
     - scanLogs.identificationMethod = "manual" | "rfid"
   ============================================================ */

const DB_NAME    = 'khaan_netra_v2';
const DB_VERSION = 1;

const STORES = {
  workers:   'workers',
  scanLogs:  'scanLogs',
  alerts:    'alerts',
};

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      /* workers - keyed by workerId */
      if (!db.objectStoreNames.contains(STORES.workers)) {
        const ws = db.createObjectStore(STORES.workers, { keyPath: 'workerId' });
        ws.createIndex('name', 'name', { unique: false });
        ws.createIndex('rfidTag', 'rfidTag', { unique: false });
      }

      /* scanLogs - auto-increment id */
      if (!db.objectStoreNames.contains(STORES.scanLogs)) {
        const sl = db.createObjectStore(STORES.scanLogs, { keyPath: 'id', autoIncrement: true });
        sl.createIndex('workerId',   'workerId',   { unique: false });
        sl.createIndex('timestamp',  'timestamp',  { unique: false });
        sl.createIndex('score',      'score',      { unique: false });
      }

      /* alerts - auto-increment id */
      if (!db.objectStoreNames.contains(STORES.alerts)) {
        const al = db.createObjectStore(STORES.alerts, { keyPath: 'id', autoIncrement: true });
        al.createIndex('timestamp', 'timestamp', { unique: false });
        al.createIndex('type',      'type',      { unique: false });
        al.createIndex('workerId',  'workerId',  { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = (e) => reject(e.target.error);
  });
}

/* ---------- Generic CRUD helpers ---------- */

async function _tx(storeName, mode) {
  const db  = await openDB();
  const tx  = db.transaction(storeName, mode);
  const st  = tx.objectStore(storeName);
  return { tx, store: st };
}

function _req(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror   = () => reject(idbRequest.error);
  });
}

/* ---------- Workers ---------- */

async function putWorker(worker) {
  /*  worker = {
        workerId:  string,
        name:      string,
        rfidTag:   string | null,   ← Phase 2
        createdAt: number
      }
  */
  const { store } = await _tx(STORES.workers, 'readwrite');
  return _req(store.put(worker));
}

async function getWorker(workerId) {
  const { store } = await _tx(STORES.workers, 'readonly');
  return _req(store.get(workerId));
}

async function getAllWorkers() {
  const { store } = await _tx(STORES.workers, 'readonly');
  return _req(store.getAll());
}

async function upsertWorker(workerId, name) {
  let existing = await getWorker(workerId);
  if (!existing) {
    existing = {
      workerId,
      name,
      rfidTag: null,                   // Phase 2 placeholder
      createdAt: Date.now(),
    };
  } else {
    existing.name = name;              // Update name if changed
  }
  return putWorker(existing);
}

/* ---------- Scan Logs ---------- */

async function addScanLog(log) {
  /*  log = {
        workerId:             string,
        workerName:           string,
        timestamp:            number (ms),
        identificationMethod: "manual" | "rfid",
        detections:           [ { item, detected, confidence } ],
        score:                number (0-100),
        verdict:              "allow" | "deny",
        snapshot:             string | null (base64 jpeg)
      }
  */
  const { store } = await _tx(STORES.scanLogs, 'readwrite');
  return _req(store.add(log));
}

async function getAllScanLogs() {
  const { store } = await _tx(STORES.scanLogs, 'readonly');
  return _req(store.getAll());
}

async function getScanLogsByWorker(workerId) {
  const { store } = await _tx(STORES.scanLogs, 'readonly');
  const idx = store.index('workerId');
  return _req(idx.getAll(workerId));
}

async function getRecentScanLogs(limit = 50) {
  const all = await getAllScanLogs();
  all.sort((a, b) => b.timestamp - a.timestamp);
  return all.slice(0, limit);
}

/* ---------- Alerts ---------- */

async function addAlert(alert) {
  /*  alert = {
        timestamp: number,
        type:      "deny" | "violation" | "warning" | "repeat_offender",
        workerId:  string,
        workerName:string,
        message:   string,
        score:     number | null
      }
  */
  const { store } = await _tx(STORES.alerts, 'readwrite');
  return _req(store.add(alert));
}

async function getAllAlerts() {
  const { store } = await _tx(STORES.alerts, 'readonly');
  return _req(store.getAll());
}

async function getRecentAlerts(limit = 30) {
  const all = await getAllAlerts();
  all.sort((a, b) => b.timestamp - a.timestamp);
  return all.slice(0, limit);
}

/* ---------- Analytics helpers ---------- */

async function getWorkerStats(workerId) {
  const logs = await getScanLogsByWorker(workerId);
  if (logs.length === 0) return null;
  const scores   = logs.map(l => l.score);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const denials  = logs.filter(l => l.verdict === 'deny').length;
  return {
    totalScans: logs.length,
    avgScore,
    denials,
    lastScan: logs.sort((a, b) => b.timestamp - a.timestamp)[0],
  };
}

async function getDashboardStats() {
  const logs   = await getAllScanLogs();
  const alerts = await getAllAlerts();

  const today     = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs   = today.getTime();

  const todayLogs   = logs.filter(l => l.timestamp >= todayMs);
  const todayAlerts = alerts.filter(a => a.timestamp >= todayMs);

  const scores = todayLogs.map(l => l.score);
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  const compliant = todayLogs.filter(l => l.verdict === 'allow').length;
  const complianceRate = todayLogs.length
    ? Math.round((compliant / todayLogs.length) * 100)
    : 0;

  return {
    totalScanned:   todayLogs.length,
    complianceRate,
    alertsToday:    todayAlerts.length,
    avgScore,
    allLogs:        logs,
    todayLogs,
  };
}

async function getLeaderboard(limit = 5) {
  const workers = await getAllWorkers();
  const stats   = [];

  for (const w of workers) {
    const s = await getWorkerStats(w.workerId);
    if (s) {
      stats.push({ ...w, ...s });
    }
  }

  stats.sort((a, b) => b.avgScore - a.avgScore);
  return stats.slice(0, limit);
}

/* ---------- Export ---------- */

async function exportData(format = 'json') {
  const workers  = await getAllWorkers();
  const scanLogs = await getAllScanLogs();
  const alerts   = await getAllAlerts();

  if (format === 'json') {
    const data = JSON.stringify({ workers, scanLogs, alerts }, null, 2);
    _downloadFile(data, 'khaan-netra-export.json', 'application/json');
  } else if (format === 'csv') {
    const csvRows = [
      ['ID', 'Worker ID', 'Worker Name', 'Timestamp', 'ID Method', 'Score', 'Verdict', 'Helmet', 'Vest', 'Boots'].join(','),
    ];
    for (const log of scanLogs) {
      const helmet = log.detections.find(d => d.item === 'Helmet');
      const vest   = log.detections.find(d => d.item === 'Vest');
      const boots  = log.detections.find(d => d.item === 'Boots');
      csvRows.push([
        log.id,
        log.workerId,
        `"${log.workerName}"`,
        new Date(log.timestamp).toISOString(),
        log.identificationMethod,
        log.score,
        log.verdict,
        helmet ? (helmet.detected ? `${helmet.confidence}%` : 'MISSING') : '--',
        vest   ? (vest.detected   ? `${vest.confidence}%`   : 'MISSING') : '--',
        boots  ? (boots.detected  ? `${boots.confidence}%`  : 'MISSING') : '--',
      ].join(','));
    }
    _downloadFile(csvRows.join('\n'), 'khaan-netra-export.csv', 'text/csv');
  }
}

function _downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- Demo data seeder ---------- */

async function seedDemoData() {
  const existing = await getAllWorkers();
  if (existing.length > 0) return; // Already seeded

  // Realistic Indian mining worker names
  const demoWorkers = [
    { workerId: 'MKR-0041', name: 'Rajesh Kumar',     rfidTag: null, createdAt: Date.now() - 86400000 * 14 },
    { workerId: 'MKR-0078', name: 'Sunil Prasad',     rfidTag: null, createdAt: Date.now() - 86400000 * 12 },
    { workerId: 'MKR-0023', name: 'Anil Thakur',      rfidTag: null, createdAt: Date.now() - 86400000 * 10 },
    { workerId: 'MKR-0115', name: 'Deepak Mahto',     rfidTag: null, createdAt: Date.now() - 86400000 * 9 },
    { workerId: 'MKR-0092', name: 'Vikram Singh',     rfidTag: null, createdAt: Date.now() - 86400000 * 8 },
    { workerId: 'MKR-0056', name: 'Manoj Oraon',      rfidTag: null, createdAt: Date.now() - 86400000 * 7 },
    { workerId: 'MKR-0134', name: 'Sanjay Murmu',     rfidTag: null, createdAt: Date.now() - 86400000 * 5 },
    { workerId: 'MKR-0067', name: 'Ramesh Hansda',    rfidTag: null, createdAt: Date.now() - 86400000 * 3 },
    { workerId: 'MKR-0201', name: 'Pradeep Tudu',     rfidTag: null, createdAt: Date.now() - 86400000 * 2 },
    { workerId: 'MKR-0089', name: 'Amit Kisku',       rfidTag: null, createdAt: Date.now() - 86400000 * 1 },
  ];

  for (const w of demoWorkers) {
    await putWorker(w);
  }

  // Demo scan logs with messy, realistic data
  // Includes borderline scores, repeat offender, odd gaps
  const now = Date.now();
  const HOUR = 3600000;
  const demoLogs = [
    // Yesterday shift A - mostly compliant
    { workerId: 'MKR-0041', workerName: 'Rajesh Kumar',  timestamp: now - 28*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 92 },{ item: 'Vest', detected: true, confidence: 87 },{ item: 'Boots', detected: true, confidence: 74 },{ item: 'Self-Rescuer', detected: true, confidence: 68 },{ item: 'Gas Detector', detected: true, confidence: 71 }], score: 95, verdict: 'allow', snapshot: null },
    { workerId: 'MKR-0078', workerName: 'Sunil Prasad',  timestamp: now - 27.5*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 88 },{ item: 'Vest', detected: true, confidence: 91 },{ item: 'Boots', detected: true, confidence: 65 },{ item: 'Self-Rescuer', detected: false, confidence: 12 },{ item: 'Gas Detector', detected: true, confidence: 77 }], score: 85, verdict: 'allow', snapshot: null },
    { workerId: 'MKR-0023', workerName: 'Anil Thakur',   timestamp: now - 27*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: false, confidence: 18 },{ item: 'Vest', detected: true, confidence: 83 },{ item: 'Boots', detected: true, confidence: 59 },{ item: 'Self-Rescuer', detected: false, confidence: 8 },{ item: 'Gas Detector', detected: false, confidence: 5 }], score: 50, verdict: 'allow', snapshot: null },
    { workerId: 'MKR-0115', workerName: 'Deepak Mahto',  timestamp: now - 26*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 94 },{ item: 'Vest', detected: true, confidence: 89 },{ item: 'Boots', detected: true, confidence: 81 },{ item: 'Self-Rescuer', detected: true, confidence: 72 },{ item: 'Gas Detector', detected: true, confidence: 85 }], score: 100, verdict: 'allow', snapshot: null },

    // Yesterday shift B - includes violation
    { workerId: 'MKR-0092', workerName: 'Vikram Singh',  timestamp: now - 20*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 79 },{ item: 'Vest', detected: true, confidence: 84 },{ item: 'Boots', detected: false, confidence: 22 },{ item: 'Self-Rescuer', detected: false, confidence: 10 },{ item: 'Gas Detector', detected: false, confidence: 7 }], score: 55, verdict: 'allow', snapshot: null },
    { workerId: 'MKR-0056', workerName: 'Manoj Oraon',   timestamp: now - 19.5*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: false, confidence: 15 },{ item: 'Vest', detected: false, confidence: 11 },{ item: 'Boots', detected: false, confidence: 9 },{ item: 'Self-Rescuer', detected: false, confidence: 5 },{ item: 'Gas Detector', detected: false, confidence: 3 }], score: 0, verdict: 'deny', snapshot: null },
    // Manoj re-scan after suiting up (gap in timestamps)
    { workerId: 'MKR-0056', workerName: 'Manoj Oraon',   timestamp: now - 19*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 90 },{ item: 'Vest', detected: true, confidence: 86 },{ item: 'Boots', detected: true, confidence: 67 },{ item: 'Self-Rescuer', detected: false, confidence: 14 },{ item: 'Gas Detector', detected: false, confidence: 9 }], score: 80, verdict: 'allow', snapshot: null },

    // Today shift A - current
    { workerId: 'MKR-0134', workerName: 'Sanjay Murmu',  timestamp: now - 4*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 91 },{ item: 'Vest', detected: true, confidence: 88 },{ item: 'Boots', detected: true, confidence: 72 },{ item: 'Self-Rescuer', detected: true, confidence: 65 },{ item: 'Gas Detector', detected: true, confidence: 79 }], score: 100, verdict: 'allow', snapshot: null },
    { workerId: 'MKR-0067', workerName: 'Ramesh Hansda', timestamp: now - 3.5*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 85 },{ item: 'Vest', detected: false, confidence: 19 },{ item: 'Boots', detected: true, confidence: 61 },{ item: 'Self-Rescuer', detected: false, confidence: 7 },{ item: 'Gas Detector', detected: false, confidence: 4 }], score: 55, verdict: 'allow', snapshot: null },
    // Borderline: exactly 29% - DENIED
    { workerId: 'MKR-0023', workerName: 'Anil Thakur',   timestamp: now - 3*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: false, confidence: 20 },{ item: 'Vest', detected: true, confidence: 76 },{ item: 'Boots', detected: false, confidence: 13 },{ item: 'Self-Rescuer', detected: false, confidence: 6 },{ item: 'Gas Detector', detected: false, confidence: 3 }], score: 25, verdict: 'deny', snapshot: null },
    // Borderline: exactly 31% - ALLOWED
    { workerId: 'MKR-0201', workerName: 'Pradeep Tudu',  timestamp: now - 2.5*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 72 },{ item: 'Vest', detected: false, confidence: 16 },{ item: 'Boots', detected: false, confidence: 11 },{ item: 'Self-Rescuer', detected: false, confidence: 5 },{ item: 'Gas Detector', detected: false, confidence: 4 }], score: 30, verdict: 'allow', snapshot: null },
    { workerId: 'MKR-0041', workerName: 'Rajesh Kumar',  timestamp: now - 2*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 93 },{ item: 'Vest', detected: true, confidence: 90 },{ item: 'Boots', detected: true, confidence: 78 },{ item: 'Self-Rescuer', detected: true, confidence: 70 },{ item: 'Gas Detector', detected: true, confidence: 82 }], score: 100, verdict: 'allow', snapshot: null },
    // Repeat offender - Anil Thakur again, denied again
    { workerId: 'MKR-0023', workerName: 'Anil Thakur',   timestamp: now - 1.5*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: false, confidence: 14 },{ item: 'Vest', detected: false, confidence: 10 },{ item: 'Boots', detected: true, confidence: 55 },{ item: 'Self-Rescuer', detected: false, confidence: 8 },{ item: 'Gas Detector', detected: false, confidence: 6 }], score: 25, verdict: 'deny', snapshot: null },
    { workerId: 'MKR-0089', workerName: 'Amit Kisku',    timestamp: now - 0.5*HOUR, identificationMethod: 'manual', detections: [{ item: 'Helmet', detected: true, confidence: 87 },{ item: 'Vest', detected: true, confidence: 92 },{ item: 'Boots', detected: true, confidence: 69 },{ item: 'Self-Rescuer', detected: true, confidence: 74 },{ item: 'Gas Detector', detected: false, confidence: 18 }], score: 90, verdict: 'allow', snapshot: null },
  ];

  for (const log of demoLogs) {
    await addScanLog(log);
  }

  // Demo alerts matching denied entries
  const demoAlerts = [
    { timestamp: now - 19.5*HOUR, type: 'deny',     workerId: 'MKR-0056', workerName: 'Manoj Oraon',  message: 'ENTRY DENIED - NO PPE DETECTED. Score 0%. All essential items missing.', score: 0 },
    { timestamp: now - 3*HOUR,    type: 'deny',     workerId: 'MKR-0023', workerName: 'Anil Thakur',  message: 'ENTRY DENIED - HELMET NOT DETECTED. Score 25%.', score: 25 },
    { timestamp: now - 1.5*HOUR,  type: 'repeat_offender', workerId: 'MKR-0023', workerName: 'Anil Thakur', message: '3 REPEAT VIOLATIONS THIS SHIFT - Anil Thakur (MKR-0023). Supervisor notified.', score: 25 },
    { timestamp: now - 1.5*HOUR,  type: 'deny',     workerId: 'MKR-0023', workerName: 'Anil Thakur',  message: 'ENTRY DENIED - HELMET, VEST NOT DETECTED. Score 25%.', score: 25 },
    { timestamp: now - 2.5*HOUR,  type: 'warning',  workerId: 'MKR-0201', workerName: 'Pradeep Tudu', message: 'BORDERLINE ENTRY - Score 30%. Vest and boots not detected. Cleared with minimum threshold.', score: 30 },
  ];

  for (const alert of demoAlerts) {
    await addAlert(alert);
  }
}

/* ---------- Public API ---------- */
window.DataStore = {
  openDB,
  // Workers
  putWorker,
  getWorker,
  getAllWorkers,
  upsertWorker,
  // Scan logs
  addScanLog,
  getAllScanLogs,
  getScanLogsByWorker,
  getRecentScanLogs,
  // Alerts
  addAlert,
  getAllAlerts,
  getRecentAlerts,
  // Analytics
  getWorkerStats,
  getDashboardStats,
  getLeaderboard,
  // Export
  exportData,
  // Seed
  seedDemoData,
};
