/* ============================================================
   KHAAN NETRA - Dashboard Controller
   Stats, charts, tables, alert feed, leaderboard.
   ============================================================ */

let _complianceChart = null;

async function initDashboard() {
  await renderStats();
  await renderComplianceChart();
  await renderRecentScans();
  await renderAlertFeed();
  await renderLeaderboard();
}

async function refreshDashboard() {
  await renderStats();
  await updateComplianceChart();
  await renderRecentScans();
  await renderAlertFeed();
  await renderLeaderboard();
}

/* ---------- Stat cards ---------- */

async function renderStats() {
  const stats = await DataStore.getDashboardStats();

  _setText('stat-scanned',    stats.totalScanned);
  _setText('stat-compliance', stats.complianceRate + '%');
  _setText('stat-alerts',     stats.alertsToday);
  _setText('stat-avg-score',  stats.avgScore + '%');

  // Color the values
  const compEl = document.getElementById('stat-compliance');
  if (compEl) {
    compEl.className = 'stat-card__value stat-card__value--' + Compliance.scoreColor(stats.complianceRate);
  }
  const avgEl = document.getElementById('stat-avg-score');
  if (avgEl) {
    avgEl.className = 'stat-card__value stat-card__value--' + Compliance.scoreColor(stats.avgScore);
  }
  const alertEl = document.getElementById('stat-alerts');
  if (alertEl) {
    alertEl.className = 'stat-card__value stat-card__value--' + (stats.alertsToday > 0 ? 'red' : 'green');
  }
}

/* ---------- Compliance trend chart ---------- */

async function renderComplianceChart() {
  const canvas = document.getElementById('compliance-chart');
  if (!canvas) return;

  const logs = await DataStore.getAllScanLogs();
  const chartData = _buildChartData(logs);

  if (_complianceChart) {
    _complianceChart.destroy();
  }

  const ctx = canvas.getContext('2d');

  _complianceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [
        {
          label: 'Avg Score',
          data: chartData.avgScores,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.08)',
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: '#f59e0b',
          pointBorderColor: '#0b0f19',
          pointBorderWidth: 2,
        },
        {
          label: 'Scans',
          data: chartData.counts,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6,182,212,0.06)',
          borderWidth: 1.5,
          fill: false,
          tension: 0.35,
          pointRadius: 2,
          pointBackgroundColor: '#06b6d4',
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: '#7e8a9e',
            font: { family: "'Barlow Condensed', sans-serif", size: 11, weight: '600' },
            boxWidth: 12,
            boxHeight: 2,
            padding: 12,
            usePointStyle: false,
          },
        },
        tooltip: {
          backgroundColor: '#1c2540',
          borderColor: '#243048',
          borderWidth: 1,
          titleColor: '#dfe4ed',
          bodyColor: '#7e8a9e',
          titleFont: { family: "'Barlow Condensed', sans-serif", size: 12, weight: '600' },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
          padding: 10,
          displayColors: false,
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(36,48,72,0.4)', lineWidth: 0.5 },
          ticks: {
            color: '#3f4d63',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            maxRotation: 0,
          },
          border: { color: '#243048' },
        },
        y: {
          position: 'left',
          min: 0,
          max: 100,
          grid: { color: 'rgba(36,48,72,0.3)', lineWidth: 0.5 },
          ticks: {
            color: '#3f4d63',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            callback: v => v + '%',
          },
          border: { display: false },
        },
        y1: {
          position: 'right',
          min: 0,
          grid: { display: false },
          ticks: {
            color: '#3f4d63',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            stepSize: 1,
          },
          border: { display: false },
        },
      },
    },
  });
}

async function updateComplianceChart() {
  if (!_complianceChart) return renderComplianceChart();
  const logs = await DataStore.getAllScanLogs();
  const chartData = _buildChartData(logs);
  _complianceChart.data.labels = chartData.labels;
  _complianceChart.data.datasets[0].data = chartData.avgScores;
  _complianceChart.data.datasets[1].data = chartData.counts;
  _complianceChart.update('none');
}

function _buildChartData(logs) {
  // Group by hour for last 24h
  const now = Date.now();
  const buckets = {};

  for (let i = 23; i >= 0; i--) {
    const t = new Date(now - i * 3600000);
    const key = t.getHours().toString().padStart(2, '0') + ':00';
    buckets[key] = { scores: [], count: 0 };
  }

  for (const log of logs) {
    if (now - log.timestamp > 24 * 3600000) continue;
    const t   = new Date(log.timestamp);
    const key = t.getHours().toString().padStart(2, '0') + ':00';
    if (buckets[key]) {
      buckets[key].scores.push(log.score);
      buckets[key].count++;
    }
  }

  const labels    = Object.keys(buckets);
  const avgScores = labels.map(k => {
    const b = buckets[k];
    return b.scores.length ? Math.round(b.scores.reduce((a, c) => a + c, 0) / b.scores.length) : null;
  });
  const counts = labels.map(k => buckets[k].count);

  return { labels, avgScores, counts };
}

/* ---------- Recent scans table ---------- */

async function renderRecentScans() {
  const tbody = document.getElementById('recent-scans-body');
  if (!tbody) return;

  const logs = await DataStore.getRecentScanLogs(20);

  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="7" class="text-dim" style="text-align:center;padding:var(--sp-6);">
        No scans recorded yet. Use the CV Scanner to begin.
      </td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const time = _formatTime(log.timestamp);
    const ppeIcons = _buildPPEIcons(log.detections);
    const scoreClass = Compliance.scoreColor(log.score);
    const verdictBadge = log.verdict === 'allow'
      ? '<span class="badge badge--green">ALLOW</span>'
      : '<span class="badge badge--red">DENY</span>';

    return `
      <tr>
        <td class="mono">${_escapeHtml(log.workerId)}</td>
        <td>${_escapeHtml(log.workerName)}</td>
        <td class="mono">${time}</td>
        <td>${ppeIcons}</td>
        <td>
          <span class="mono text-${scoreClass}" style="font-weight:600">${log.score}%</span>
          <span class="score-bar-mini">
            <span class="score-bar-mini__fill" style="width:${log.score}%;background:var(--${scoreClass})"></span>
          </span>
        </td>
        <td>${verdictBadge}</td>
        <td class="text-dim mono" style="font-size:var(--text-2xs)">${log.identificationMethod.toUpperCase()}</td>
      </tr>`;
  }).join('');
}

function _buildPPEIcons(detections) {
  const essentials = ['Helmet', 'Vest', 'Boots'];
  return essentials.map(name => {
    const det = detections.find(d => d.item === name);
    const ok = det && det.detected;
    const abbr = name === 'Helmet' ? 'H' : name === 'Vest' ? 'V' : 'B';
    return `<span title="${name}: ${ok ? 'Detected' : 'Missing'}"
      style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:18px;
      font-family:var(--font-display);font-size:var(--text-2xs);font-weight:700;
      border-radius:var(--r-sm);margin-right:2px;
      background:${ok ? 'var(--green-bg)' : 'var(--red-bg)'};
      color:${ok ? 'var(--green)' : 'var(--red)'};
      border:1px solid ${ok ? 'var(--green-border)' : 'var(--red-border)'}">
      ${abbr}</span>`;
  }).join('');
}

/* ---------- Alert feed ---------- */

async function renderAlertFeed() {
  const container = document.getElementById('alert-feed');
  if (!container) return;

  const alerts = await DataStore.getRecentAlerts(15);

  if (alerts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div class="empty-state__text">No alerts this shift</div>
      </div>`;
    return;
  }

  container.innerHTML = alerts.map(a => {
    const levelClass = a.type === 'deny' || a.type === 'repeat_offender' ? 'red'
                     : a.type === 'warning' ? 'amber' : 'green';
    const iconSvg = levelClass === 'red'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

    return `
      <div class="alert-feed-item alert-feed-item--${levelClass}">
        <div class="alert-feed-item__icon">${iconSvg}</div>
        <div class="alert-feed-item__body">
          <div class="alert-feed-item__msg">${_escapeHtml(a.message)}</div>
          <div class="alert-feed-item__time">${_formatTime(a.timestamp)} · ${_escapeHtml(a.workerName)}</div>
        </div>
      </div>`;
  }).join('');
}

/* ---------- Leaderboard ---------- */

async function renderLeaderboard() {
  const container = document.getElementById('leaderboard');
  if (!container) return;

  const leaders = await DataStore.getLeaderboard(6);

  if (leaders.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
        <div class="empty-state__text">No worker data yet</div>
      </div>`;
    return;
  }

  container.innerHTML = leaders.map((w, i) => {
    const scoreClass = Compliance.scoreColor(w.avgScore);
    const initials = w.name.split(' ').map(n => n[0]).join('').substring(0, 2);

    return `
      <div class="leaderboard-item">
        <div class="leaderboard-item__rank">${i + 1}</div>
        <div class="worker-card__avatar">${initials}</div>
        <div class="leaderboard-item__info">
          <div class="leaderboard-item__name">${_escapeHtml(w.name)}</div>
          <div class="leaderboard-item__id">${_escapeHtml(w.workerId)} · ${w.totalScans} scans</div>
        </div>
        <div class="leaderboard-item__score text-${scoreClass}">${w.avgScore}%</div>
      </div>`;
  }).join('');
}

/* ---------- Workers page ---------- */

async function renderWorkersPage() {
  const container = document.getElementById('workers-list');
  if (!container) return;

  const workers = await DataStore.getAllWorkers();

  if (workers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__text">No workers registered. Scan a worker to add them.</div>
      </div>`;
    return;
  }

  const cards = [];
  for (const w of workers) {
    const stats = await DataStore.getWorkerStats(w.workerId);
    const initials = w.name.split(' ').map(n => n[0]).join('').substring(0, 2);
    const scoreClass = stats ? Compliance.scoreColor(stats.avgScore) : 'dim';
    const lastTime = stats && stats.lastScan ? _formatTime(stats.lastScan.timestamp) : '--';

    cards.push(`
      <div class="worker-card">
        <div class="worker-card__header">
          <div class="worker-card__avatar">${initials}</div>
          <div>
            <div class="worker-card__name">${_escapeHtml(w.name)}</div>
            <div class="worker-card__id">${_escapeHtml(w.workerId)}${w.rfidTag ? ' · RFID: ' + w.rfidTag : ''}</div>
          </div>
        </div>
        <div class="worker-card__stats">
          <div>
            <div class="worker-card__stat-label">Avg Score</div>
            <div class="worker-card__stat-value text-${scoreClass}">${stats ? stats.avgScore + '%' : '--'}</div>
          </div>
          <div>
            <div class="worker-card__stat-label">Total Scans</div>
            <div class="worker-card__stat-value">${stats ? stats.totalScans : '0'}</div>
          </div>
          <div>
            <div class="worker-card__stat-label">Denials</div>
            <div class="worker-card__stat-value ${stats && stats.denials > 0 ? 'text-red' : ''}">${stats ? stats.denials : '0'}</div>
          </div>
        </div>
        <div style="font-size:var(--text-2xs);color:var(--text-dim);font-family:var(--font-mono)">
          Last scan: ${lastTime}
        </div>
      </div>`);
  }

  container.innerHTML = cards.join('');
}

/* ---------- Alerts log page ---------- */

async function renderAlertsPage() {
  const container = document.getElementById('alerts-log-list');
  if (!container) return;

  const alerts = await DataStore.getAllAlerts();
  alerts.sort((a, b) => b.timestamp - a.timestamp);

  if (alerts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__text">No alerts recorded</div>
      </div>`;
    return;
  }

  container.innerHTML = alerts.map(a => {
    const levelClass = (a.type === 'deny' || a.type === 'repeat_offender') ? 'red'
                     : a.type === 'warning' ? 'amber' : 'cyan';
    const typeLabel  = a.type.replace(/_/g, ' ').toUpperCase();
    return `
      <div class="alerts-log-item">
        <span class="mono" style="font-size:var(--text-xs);color:var(--text-dim)">${_formatTime(a.timestamp)}</span>
        <span class="badge badge--${levelClass}">${typeLabel}</span>
        <span style="font-size:var(--text-sm)">${_escapeHtml(a.message)}</span>
        <span class="mono" style="font-size:var(--text-xs);color:var(--text-dim)">${_escapeHtml(a.workerId)}</span>
      </div>`;
  }).join('');
}

/* ---------- Helpers ---------- */

function _setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function _formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  if (sameDay) return time;
  if (isYesterday) return `Yest ${time}`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + time;
}

function _escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* ---------- Public API ---------- */
window.Dashboard = {
  initDashboard,
  refreshDashboard,
  renderStats,
  renderRecentScans,
  renderAlertFeed,
  renderLeaderboard,
  renderWorkersPage,
  renderAlertsPage,
};
