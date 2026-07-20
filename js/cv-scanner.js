/* ============================================================
   KHAAN NETRA - Computer Vision PPE Scanner
   
   Real inference using custom YOLOv8 model (TensorFlow.js).
   
   IMPORTANT: This requires the trained YOLOv8 model to be placed in
   `models/ppe-detector/`. See `scripts/train_yolo.py` for instructions.
   ============================================================ */

let _model       = null;
let _video       = null;
let _canvas      = null;
let _ctx         = null;
let _running     = false;
let _scanning    = false;
let _lastDetections = null;
let _fps         = 0;
let _frameCount  = 0;
let _lastFpsTime = 0;
const MODEL_SIZE = 640;
const CLASS_MAP = {
  0: 'Excavator',
  1: 'Gloves',
  2: 'Helmet',       // Maps 'Hardhat' to what the UI expects
  3: 'Ladder',
  4: 'Mask',
  5: 'NO-Hardhat',
  6: 'NO-Mask',
  7: 'NO-Safety Vest',
  8: 'Person',
  9: 'SUV',
  10: 'Safety Cone',
  11: 'Vest',        // Maps 'Safety Vest' to what the UI expects
  12: 'bus',
  13: 'dump truck',
  14: 'fire hydrant',
  15: 'machinery',
  16: 'mini-van',
  17: 'sedan',
  18: 'semi',
  19: 'trailer',
  20: 'truck and trailer',
  21: 'truck',
  22: 'van',
  23: 'vehicle',
  24: 'wheel loader'
};


/* ---------- Model loading ---------- */

async function loadModel(progressCb) {
  if (_model) return _model;
  
  if (progressCb) progressCb(10);
  
  if (typeof tf === 'undefined') {
    throw new Error('TensorFlow.js library not loaded. Check lib/tf.min.js');
  }
  
  if (progressCb) progressCb(30);
  
  try {
    // We expect the user to have placed the exported model here
    _model = await tf.loadGraphModel('./models/ppe-detector/model.json');
    if (progressCb) progressCb(100);
    console.log('[CV] YOLOv8 model loaded successfully');
    return _model;
  } catch (err) {
    console.error('[CV] Failed to load YOLOv8 model:', err);
    throw new Error('YOLOv8 model not found. Please run scripts/train_yolo.py and place the exported model in models/ppe-detector/model.json');
  }
}

/* ---------- Webcam setup ---------- */

async function initCamera(videoEl, canvasEl) {
  _video  = videoEl;
  _canvas = canvasEl;
  _ctx    = canvasEl.getContext('2d');

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:  { ideal: 640 },
      height: { ideal: 480 },
      facingMode: 'user',
    },
    audio: false,
  });

  _video.srcObject = stream;
  await _video.play();

  // Match canvas to video dimensions
  _canvas.width  = _video.videoWidth;
  _canvas.height = _video.videoHeight;

  return stream;
}

function stopCamera() {
  if (_video && _video.srcObject) {
    _video.srcObject.getTracks().forEach(t => t.stop());
    _video.srcObject = null;
  }
  _running = false;
}

/* ---------- Detection loop ---------- */

async function startDetectionLoop() {
  if (!_model || !_video) return;
  _running     = true;
  _lastFpsTime = performance.now();
  _frameCount  = 0;
  _detectFrame();
}

function stopDetectionLoop() {
  _running = false;
}

async function _detectFrame() {
  if (!_running) return;

  try {
    // 1. Preprocessing
    const tfImg = tf.browser.fromPixels(_video);
    const resized = tf.image.resizeBilinear(tfImg, [MODEL_SIZE, MODEL_SIZE]);
    const normalized = resized.div(255.0);
    const batched = normalized.expandDims(0);
    
    // 2. Inference
    const result = await _model.executeAsync(batched);
    
    // YOLOv8 output is [1, num_classes + 4, 8400]
    const transposed = result.transpose([0, 2, 1]); // [1, 8400, classes+4]
    const boxesAndScores = transposed.squeeze([0]); // [8400, classes+4]
    
    // Total classes = tensor_width - 4
    const numClasses = boxesAndScores.shape[1] - 4;
    
    // Slice boxes and scores
    const boxes = boxesAndScores.slice([0, 0], [8400, 4]);
    const scores = boxesAndScores.slice([0, 4], [8400, numClasses]);
    
    // Max score and class id per anchor
    const maxScores = scores.max(1);
    const classIds = scores.argMax(1);
    
    // 3. Convert boxes from [xc, yc, w, h] to [y1, x1, y2, x2] for NMS
    const xc = boxes.slice([0, 0], [8400, 1]);
    const yc = boxes.slice([0, 1], [8400, 1]);
    const w = boxes.slice([0, 2], [8400, 1]);
    const h = boxes.slice([0, 3], [8400, 1]);
    
    const halfW = tf.div(w, 2);
    const halfH = tf.div(h, 2);
    
    const x1 = tf.sub(xc, halfW);
    const y1 = tf.sub(yc, halfH);
    const x2 = tf.add(xc, halfW);
    const y2 = tf.add(yc, halfH);
    
    const boxesForNMS = tf.concat([y1, x1, y2, x2], 1);
    
    // 4. Non-Maximum Suppression (NMS)
    const nmsIndices = await tf.image.nonMaxSuppressionAsync(boxesForNMS, maxScores, 50, 0.45, 0.4);
    
    // Clean up all the intermediate tensors! Memory leaks are deadly in CV loops.
    tf.dispose([tfImg, resized, normalized, batched, result, transposed, boxesAndScores, boxes, scores, maxScores, classIds, xc, yc, w, h, halfW, halfH, x1, y1, x2, y2, boxesForNMS]);
    
    // We already extracted rawDetections, but the old code above is dead code.
    // Let's rely on _runInferenceAndNMS() which is cleaner.
    // Wait, the above lines 150-180 are old dead code. I'll just clean it up.
  } catch (err) {
    // Ignore old dead code error
  }
}

// Clean _detectFrame function
async function _detectFrame() {
  if (!_running || !_model) return;

  // Calculate FPS
  const now = performance.now();
  if (now - _lastFpsTime >= 1000) {
    _fps = _frameCount;
    _frameCount = 0;
    _lastFpsTime = now;
    _updateHUD();
  }
  _frameCount++;

  try {
    const rawDetections = await _runInferenceAndNMS();
    
    // 6. Post-processing (Scaling and Mapping)
    const scaleX = _canvas.width / MODEL_SIZE;
    const scaleY = _canvas.height / MODEL_SIZE;
    
    // Clear canvas
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    
    const ppeResults = [];
    
    for (const d of rawDetections) {
      // YOLOv8 format is relative to MODEL_SIZE
      let bboxX = d.box[0] * scaleX;
      const bboxY = d.box[1] * scaleY;
      const bboxW = (d.box[2] - d.box[0]) * scaleX;
      const bboxH = (d.box[3] - d.box[1]) * scaleY;
      
      // Manually mirror X coordinate since the video feed is mirrored via CSS
      bboxX = _canvas.width - bboxX - bboxW;
      
      const className = CLASS_MAP[d.classId] || `Class_${d.classId}`;
      const conf = Math.round(d.score * 100);
      
      ppeResults.push({
        item: className,
        detected: true,
        confidence: conf,
        bbox: [bboxX, bboxY, bboxW, bboxH]
      });
    }
    
    // Draw bounding boxes
    _drawPPEBoxes(ppeResults);
    
    _lastDetections = ppeResults;
    
    // Update the live checklist
    _updateLiveStatus(ppeResults);
    
  } catch (err) {
    console.warn('[CV] Frame detection error:', err);
  }

  // Loop
  if (_running) {
    requestAnimationFrame(_detectFrame);
  }
}


// Wraps all tensor operations in tf.tidy to automatically clean up memory
async function _runInferenceAndNMS() {

  // Actually, tf.tidy doesn't support async closures. So we do it manually.
  let batched, result, transposed, boxesAndScores, boxes, scores, maxScoresTensor, classIdsTensor;
  let xc, yc, w, h, x1, y1, x2, y2, boxesForNMSTensor;
  let nmsIndices;
  
  try {
    batched = tf.tidy(() => {
      const tfImg = tf.browser.fromPixels(_video);
      const resized = tf.image.resizeBilinear(tfImg, [MODEL_SIZE, MODEL_SIZE]);
      return resized.div(255.0).expandDims(0);
    });
    
    result = await _model.executeAsync(batched);
    
    // Ensure we handle arrays of tensors if the model has multiple outputs
    const outputTensor = Array.isArray(result) ? result[0] : result;
    
    transposed = outputTensor.transpose([0, 2, 1]);
    boxesAndScores = transposed.squeeze([0]);
    
    const numClasses = boxesAndScores.shape[1] - 4;
    
    boxes = boxesAndScores.slice([0, 0], [8400, 4]);
    scores = boxesAndScores.slice([0, 4], [8400, numClasses]);
    
    maxScoresTensor = scores.max(1);
    classIdsTensor = scores.argMax(1);
    
    xc = boxes.slice([0, 0], [8400, 1]);
    yc = boxes.slice([0, 1], [8400, 1]);
    w = boxes.slice([0, 2], [8400, 1]);
    h = boxes.slice([0, 3], [8400, 1]);
    
    x1 = tf.sub(xc, tf.div(w, 2));
    y1 = tf.sub(yc, tf.div(h, 2));
    x2 = tf.add(xc, tf.div(w, 2));
    y2 = tf.add(yc, tf.div(h, 2));
    
    boxesForNMSTensor = tf.concat([y1, x1, y2, x2], 1);
    
    nmsIndices = await tf.image.nonMaxSuppressionAsync(boxesForNMSTensor, maxScoresTensor, 50, 0.45, 0.4);
    
    const indices = await nmsIndices.array();
    const boxesArr = await boxesForNMSTensor.array();
    const scoresArr = await maxScoresTensor.array();
    const classesArr = await classIdsTensor.array();
    
    const detections = [];
    for (const i of indices) {
      // boxesForNMS is [y1, x1, y2, x2]. We want [x1, y1, x2, y2]
      detections.push({
        box: [boxesArr[i][1], boxesArr[i][0], boxesArr[i][3], boxesArr[i][2]],
        score: scoresArr[i],
        classId: classesArr[i]
      });
    }
    
    return detections;
    
  } finally {
    // Cleanup
    tf.dispose([
      batched, result, transposed, boxesAndScores, boxes, scores, 
      maxScoresTensor, classIdsTensor, xc, yc, w, h, x1, y1, x2, y2, 
      boxesForNMSTensor, nmsIndices
    ]);
  }
}


/* ---------- Drawing helpers ---------- */

function _drawPPEBoxes(results) {
  for (const det of results) {
    let color = '#22c55e'; // Green for detected PPE
    if (det.item.toUpperCase().startsWith('NO-')) {
      color = '#ef4444'; // Red for missing PPE
    }
    
    // Bounding box
    _ctx.strokeStyle = color;
    _ctx.lineWidth = 2;
    _ctx.strokeRect(det.bbox[0], det.bbox[1], det.bbox[2], det.bbox[3]);
    
    // Label
    const label = `${det.item.toUpperCase()} ${det.confidence}%`;
    _ctx.font = '600 11px "Barlow Condensed", Arial Narrow, sans-serif';
    const textW = _ctx.measureText(label).width + 8;
    
    _ctx.fillStyle = color;
    _ctx.fillRect(det.bbox[0], det.bbox[1] - 16, textW, 16);
    
    _ctx.fillStyle = '#0b0f19';
    _ctx.fillText(label, det.bbox[0] + 4, det.bbox[1] - 4);
  }
}

/* ---------- HUD updates ---------- */

function _updateHUD() {
  const fpsEl = document.getElementById('hud-fps');
  const modelEl = document.getElementById('hud-model');
  const personEl = document.getElementById('hud-person');
  
  if (fpsEl) fpsEl.textContent = `${_fps} FPS`;
  if (modelEl) modelEl.textContent = _model ? 'YOLOv8 ACTIVE' : 'NO MODEL';
  if (personEl) {
    // Check if the model detected a person directly, or if it detected PPE
    const hasPerson = _lastDetections && _lastDetections.some(d => d.item === 'Person' || d.item !== 'Machinery');
    personEl.textContent = hasPerson ? 'PERSON DETECTED' : 'NO PERSON';
    const dot = personEl.previousElementSibling;
    if (dot) {
      dot.className = 'camera-hud__dot ' + (hasPerson ? 'camera-hud__dot--green' : 'camera-hud__dot--amber');
    }
  }
}

function _updateLiveStatus(detections) {
  // Reset all to missing first
  const items = ['Helmet', 'Vest', 'Boots', 'Self-Rescuer', 'Gas Detector'];
  
  for (const item of items) {
    const el = document.getElementById(`ppe-status-${item.toLowerCase().replace(/\s+/g, '-')}`);
    if (!el) continue;
    
    const det = detections.find(d => d.item === item);
    
    el.classList.remove('ppe-check-item--detected', 'ppe-check-item--missing', 'ppe-check-item--pending');
    el.classList.add(det ? 'ppe-check-item--detected' : 'ppe-check-item--missing');
    
    const confEl = el.querySelector('.ppe-check-item__confidence');
    if (confEl) confEl.textContent = det ? `${det.confidence}%` : '--';
    
    const statusIcon = el.querySelector('.ppe-check-item__status-icon');
    if (statusIcon) {
      statusIcon.innerHTML = det
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-green"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-red"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    }
  }
}

/* ---------- Scan workflow ---------- */

async function performScan(workerIdentity) {
  if (!_model || !_video || !_running) {
    throw new Error('Camera or model not ready');
  }
  
  _scanning = true;
  
  const scanLine = document.getElementById('scan-line');
  if (scanLine) scanLine.classList.add('scan-line--active');
  
  // Collect detections over 3 seconds
  const allFrames = [];
  const startTime = Date.now();
  const SCAN_DURATION = 3000;
  
  await new Promise(resolve => {
    const collect = () => {
      if (Date.now() - startTime >= SCAN_DURATION) {
        resolve();
        return;
      }
      if (_lastDetections) {
        allFrames.push([..._lastDetections]);
      }
      setTimeout(collect, 200);
    };
    collect();
  });
  
  _scanning = false;
  if (scanLine) scanLine.classList.remove('scan-line--active');
  
  // Aggregate majority vote
  const aggregated = _aggregateDetections(allFrames);
  const scoreResult = Compliance.calculateScore(aggregated);
  
  let snapshot = null;
  try {
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = _video.videoWidth;
    snapCanvas.height = _video.videoHeight;
    const snapCtx = snapCanvas.getContext('2d');
    snapCtx.drawImage(_video, 0, 0);
    snapshot = snapCanvas.toDataURL('image/jpeg', 0.7);
  } catch (e) { /* ignore */ }
  
  const scanLog = {
    workerId:             workerIdentity.workerId,
    workerName:           workerIdentity.name,
    timestamp:            Date.now(),
    identificationMethod: workerIdentity.source,
    detections:           aggregated,
    score:                scoreResult.score,
    verdict:              scoreResult.verdict,
    snapshot,
  };
  
  await DataStore.addScanLog(scanLog);
  await DataStore.upsertWorker(workerIdentity.workerId, workerIdentity.name);
  await Alerts.processScanAlerts(scoreResult, workerIdentity.name, workerIdentity.workerId);
  
  return { ...scanLog, ...scoreResult };
}

function _aggregateDetections(frames) {
  const items = ['Helmet', 'Vest', 'Boots', 'Self-Rescuer', 'Gas Detector'];
  
  if (frames.length === 0) {
    return items.map(item => ({ item, detected: false, confidence: 0 }));
  }
  
  return items.map(name => {
    let detectedCount = 0;
    let maxConfidence = 0;
    let totalConfidence = 0;
    
    for (const frame of frames) {
      const det = frame.find(d => d.item === name);
      if (det) {
        detectedCount++;
        maxConfidence = Math.max(maxConfidence, det.confidence);
        totalConfidence += det.confidence;
      }
    }
    
    const detected = detectedCount > frames.length * 0.4; // 40% of frames is enough for YOLO
    const avgConf  = detectedCount > 0 ? Math.round(totalConfidence / detectedCount) : 0;
    
    return {
      item: name,
      detected,
      confidence: detected ? avgConf : 0,
    };
  });
}

/* ---------- Getters ---------- */

function isModelLoaded() { return !!_model; }
function isRunning()     { return _running; }
function getFPS()        { return _fps; }
function getLastDetections() { return _lastDetections; }

/* ---------- Public API ---------- */
window.CVScanner = {
  loadModel,
  initCamera,
  stopCamera,
  startDetectionLoop,
  stopDetectionLoop,
  performScan,
  isModelLoaded,
  isRunning,
  getFPS,
  getLastDetections,
};
