/* ============================================================
   KHAAN NETRA - Compliance Scoring Engine
   Scoring formula (from spec):
     Helmet:       30 pts (essential)
     Vest:         25 pts (essential)
     Boots:        25 pts (essential)
     Self-Rescuer: 10 pts
     Gas Detector: 10 pts
   Total possible = 100
   Score < 30 → DENY ENTRY
   Score ≥ 30 → ALLOW ENTRY
   ============================================================ */

const PPE_ITEMS = [
  { item: 'Helmet',       points: 30, essential: true,  icon: 'helmet'       },
  { item: 'Vest',         points: 25, essential: true,  icon: 'vest'         },
  { item: 'Boots',        points: 25, essential: true,  icon: 'boots'        },
  { item: 'Self-Rescuer', points: 10, essential: false, icon: 'self-rescuer' },
  { item: 'Gas Detector', points: 10, essential: false, icon: 'gas-detector' },
];

const THRESHOLD = 30; // Score below this → DENY

/**
 * Calculate compliance score from detection results.
 * @param {Array<{item: string, detected: boolean, confidence: number}>} detections
 * @returns {{ score: number, verdict: 'allow'|'deny', breakdown: Array, missingEssential: string[] }}
 */
function calculateScore(detections) {
  let score = 0;
  const breakdown = [];
  const missingEssential = [];

  for (const ppe of PPE_ITEMS) {
    const det = detections.find(d => d.item === ppe.item);
    const detected = det ? det.detected : false;
    const confidence = det ? det.confidence : 0;

    if (detected) {
      score += ppe.points;
    } else if (ppe.essential) {
      missingEssential.push(ppe.item);
    }

    breakdown.push({
      ...ppe,
      detected,
      confidence,
      awarded: detected ? ppe.points : 0,
    });
  }

  const verdict = score >= THRESHOLD ? 'allow' : 'deny';

  return { score, verdict, breakdown, missingEssential };
}

/**
 * Generate an operational alert message for a scan result.
 * Terse, mine-safety-desk language - not generic dashboard copy.
 */
function generateAlertMessage(result, workerName, workerId) {
  const { score, verdict, missingEssential } = result;

  if (verdict === 'deny') {
    if (missingEssential.length === PPE_ITEMS.filter(p => p.essential).length) {
      return `ENTRY DENIED - NO PPE DETECTED. Score ${score}%. All essential items missing.`;
    }
    const missing = missingEssential.map(m => m.toUpperCase()).join(', ');
    return `ENTRY DENIED - ${missing} NOT DETECTED. Score ${score}%.`;
  }

  if (score < 50) {
    const missing = missingEssential.length > 0
      ? missingEssential.map(m => m.toUpperCase()).join(', ') + ' not detected. '
      : '';
    return `BORDERLINE ENTRY - Score ${score}%. ${missing}Cleared with minimum threshold.`;
  }

  return null; // No alert for clearly compliant scans
}

/**
 * Check if worker is a repeat offender based on recent scan history.
 * @param {string} workerId
 * @returns {Promise<{isRepeat: boolean, recentDenials: number}>}
 */
async function checkRepeatOffender(workerId) {
  const logs = await DataStore.getScanLogsByWorker(workerId);
  const now = Date.now();
  const SHIFT_WINDOW = 12 * 3600000; // 12 hours
  const recentDenials = logs.filter(
    l => l.verdict === 'deny' && (now - l.timestamp) < SHIFT_WINDOW
  ).length;
  return {
    isRepeat: recentDenials >= 2,
    recentDenials,
  };
}

/**
 * Get the color class for a score value.
 */
function scoreColor(score) {
  if (score >= 80) return 'green';
  if (score >= 30) return 'amber';
  return 'red';
}

window.Compliance = {
  PPE_ITEMS,
  THRESHOLD,
  calculateScore,
  generateAlertMessage,
  checkRepeatOffender,
  scoreColor,
};
