// =====================
//  State
// =====================
const state = {
  user:        null,
  sets:        [],
  currentSet:  null,
  tableData:   [],    // processed rows, one per image
};

const detail = {
  currentIndex: 0,
  metadata:     null,
  gridEnabled:  false,
};

// =====================
//  DOM refs
// =====================
const els = {
  btnLogout:      document.getElementById('btn-logout'),
  btnExportCsv:   document.getElementById('btn-export-csv'),
  btnExportJson:  document.getElementById('btn-export-json'),
  setSelectorDiv: document.getElementById('set-selector'),
  setList:        document.getElementById('set-list'),
  noSetsMsg:      document.getElementById('no-sets-msg'),
  dashContent:    document.getElementById('dash-content'),
  cardTotal:      document.getElementById('card-total'),
  cardRated:      document.getElementById('card-rated'),
  cardAgreement:  document.getElementById('card-agreement'),
  cardAvgDiff:    document.getElementById('card-avg-diff'),
  tbody:          document.getElementById('dash-tbody'),

  // Detail panel
  detailOverlay:      document.getElementById('detail-overlay'),
  detailPanel:        document.getElementById('detail-panel'),
  detailClose:        document.getElementById('detail-close'),
  detailImageName:    document.getElementById('detail-image-name'),
  detailPos:          document.getElementById('detail-pos'),
  detailPrev:         document.getElementById('detail-prev'),
  detailNext:         document.getElementById('detail-next'),
  detailImgOriginal:  document.getElementById('detail-img-original'),
  detailImgFpc:       document.getElementById('detail-img-fpc'),
  detailFpcContainer: document.getElementById('detail-fpc-container'),
  detailGridCanvas:   document.getElementById('detail-grid-canvas'),
  detailTooltip:      document.getElementById('detail-hover-tooltip'),
  detailToggleGrid:   document.getElementById('detail-toggle-grid'),
  detailAlgoBadge:    document.getElementById('detail-algo-badge'),
  detailCobusBadge:   document.getElementById('detail-cobus-badge'),
  detailCobusReason:  document.getElementById('detail-cobus-reasoning'),
  detailMariusBadge:  document.getElementById('detail-marius-badge'),
  detailMariusReason: document.getElementById('detail-marius-reasoning'),
  detailAgreement:    document.getElementById('detail-agreement-badge'),
  detailPieterNote:   document.getElementById('detail-pieter-note'),
  detailSaveNote:     document.getElementById('detail-save-note'),
  detailNoteSaved:    document.getElementById('detail-note-saved'),
};

// =====================
//  Init
// =====================
async function init() {
  const stored = sessionStorage.getItem('user');
  if (!stored) { window.location.href = '/'; return; }
  state.user = JSON.parse(stored);

  if (state.user.role !== 'admin') {
    window.location.href = '/rate.html';
    return;
  }

  await loadSets();
  bindEvents();
}

// =====================
//  API
// =====================
async function loadSets() {
  const res = await fetch('/api/images/sets');
  state.sets = await res.json();

  els.setList.innerHTML = '';
  if (state.sets.length === 0) {
    els.noSetsMsg.classList.remove('hidden');
    return;
  }

  for (const set of state.sets) {
    const btn = document.createElement('button');
    btn.className = 'set-list-btn';
    btn.textContent = set.name;
    btn.addEventListener('click', () => loadDashboard(set));
    els.setList.appendChild(btn);
  }
}

async function loadDashboard(set) {
  state.currentSet = set;
  els.setSelectorDiv.classList.add('hidden');
  els.dashContent.classList.remove('hidden');

  const res = await fetch(`/api/ratings/dashboard/${set.id}`);
  const raw = await res.json();

  state.tableData = processData(raw);
  renderTable(state.tableData);
  renderSummary(state.tableData);
}

// =====================
//  Data processing
// =====================
function processData(raw) {
  const raters = ['cobus', 'marius'];
  const imageMap = {};

  for (const row of raw) {
    if (!imageMap[row.image_id]) {
      imageMap[row.image_id] = {
        image_id:        row.image_id,
        filename:        row.filename,
        algorithm_score: row.algorithm_score,
        pieter_note:     row.pieter_note || null,
        scores:          {},
        reasoning:       {},
      };
    }
    if (row.username && row.score !== null) {
      imageMap[row.image_id].scores[row.username]    = row.score;
      imageMap[row.image_id].reasoning[row.username] = row.reasoning || null;
    }
    // pieter_note is the same on every row for this image; take first non-null
    if (row.pieter_note && !imageMap[row.image_id].pieter_note) {
      imageMap[row.image_id].pieter_note = row.pieter_note;
    }
  }

  return Object.values(imageMap).map(img => {
    const raterScores = raters.map(r => img.scores[r] ?? null).filter(s => s !== null);
    const fullyRated  = raterScores.length === raters.length;
    const allSame     = fullyRated && new Set(raterScores).size === 1;

    let avgDiff = null;
    if (img.algorithm_score && raterScores.length > 0) {
      const diffs = raterScores.map(s => Math.abs(s - img.algorithm_score));
      avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }

    return { ...img, fullyRated, allSame, avgDiff };
  }).sort((a, b) => a.filename.localeCompare(b.filename));
}

// =====================
//  Render table
// =====================
const SCORE_LABELS = { 1: '1 Unacceptable', 2: '2 Risk', 3: '3 Acceptable', 4: '4 Good' };
const SCORE_CLASS  = { 1: 's1', 2: 's2', 3: 's3', 4: 's4' };

function scoreBadge(score) {
  if (score === null || score === undefined)
    return '<span class="score-badge s0">—</span>';
  return `<span class="score-badge ${SCORE_CLASS[score]}">${SCORE_LABELS[score]}</span>`;
}

function reasoningText(text) {
  if (!text) return '';
  return `<p class="reasoning-note">"${text}"</p>`;
}

function renderTable(rows) {
  els.tbody.innerHTML = '';

  rows.forEach((row, idx) => {
    const tr = document.createElement('tr');

    if (row.fullyRated && row.allSame)  tr.classList.add('row-agree');
    else if (row.fullyRated)            tr.classList.add('row-disagree');

    const diffText = row.avgDiff !== null ? `±${row.avgDiff.toFixed(1)}` : '—';
    const agreementText = !row.fullyRated
      ? '<span class="badge-neutral">Incomplete</span>'
      : row.allSame
        ? '<span class="badge-agree">Agree</span>'
        : '<span class="badge-disagree">Disagree</span>';

    tr.innerHTML = `
      <td class="col-filename">${row.filename}</td>
      <td>${scoreBadge(row.algorithm_score)}</td>
      <td>
        ${scoreBadge(row.scores['cobus'])}
        ${reasoningText(row.reasoning['cobus'])}
      </td>
      <td>
        ${scoreBadge(row.scores['marius'])}
        ${reasoningText(row.reasoning['marius'])}
      </td>
      <td>${agreementText}</td>
      <td class="col-diff">${diffText}</td>
      <td class="col-detail"></td>
    `;

    const btn = document.createElement('button');
    btn.className   = 'btn btn-deep-analysis';
    btn.textContent = 'Deep Analysis';
    btn.addEventListener('click', () => openDetail(idx));
    tr.querySelector('.col-detail').appendChild(btn);

    els.tbody.appendChild(tr);
  });
}

// =====================
//  Summary cards
// =====================
function renderSummary(rows) {
  const total = rows.length;
  const rated = rows.filter(r => r.fullyRated).length;
  const agreed = rows.filter(r => r.allSame).length;

  const allDiffs = rows.filter(r => r.avgDiff !== null).map(r => r.avgDiff);
  const avgDiff  = allDiffs.length > 0
    ? (allDiffs.reduce((a, b) => a + b, 0) / allDiffs.length).toFixed(2)
    : '—';

  els.cardTotal.textContent     = total;
  els.cardRated.textContent     = `${rated} / ${total}`;
  els.cardAgreement.textContent = rated > 0 ? `${agreed} / ${rated}` : '—';
  els.cardAvgDiff.textContent   = allDiffs.length > 0 ? `±${avgDiff}` : '—';
}

// =====================
//  Detail panel
// =====================
function openDetail(idx) {
  detail.currentIndex = idx;
  detail.gridEnabled  = false;
  els.detailToggleGrid.checked = false;
  disableDetailGrid();

  els.detailOverlay.classList.remove('hidden');
  els.detailPanel.classList.add('open');

  loadDetailImage(idx);
}

function closeDetail() {
  els.detailPanel.classList.remove('open');
  els.detailOverlay.classList.add('hidden');
  disableDetailGrid();
  detail.metadata = null;
}

async function loadDetailImage(idx) {
  const row = state.tableData[idx];
  if (!row) return;

  // Header
  els.detailImageName.textContent = row.filename;
  els.detailPos.textContent       = `${idx + 1} / ${state.tableData.length}`;
  els.detailPrev.disabled         = idx === 0;
  els.detailNext.disabled         = idx === state.tableData.length - 1;

  // Images
  const base = `/uploads/${state.currentSet.name}/${row.filename}`;
  els.detailImgOriginal.src = `${base}/original.jpg`;
  els.detailImgFpc.src      = `${base}/fpc_result.jpg`;

  // Scores
  setDetailBadge(els.detailAlgoBadge,   row.algorithm_score);
  setDetailBadge(els.detailCobusBadge,  row.scores['cobus']);
  setDetailBadge(els.detailMariusBadge, row.scores['marius']);

  els.detailCobusReason.textContent  = row.reasoning['cobus']  ? `"${row.reasoning['cobus']}"` : '';
  els.detailMariusReason.textContent = row.reasoning['marius'] ? `"${row.reasoning['marius']}"` : '';

  // Agreement badge
  if (!row.fullyRated) {
    els.detailAgreement.textContent  = 'Incomplete';
    els.detailAgreement.className    = 'detail-agreement-badge badge-neutral';
  } else if (row.allSame) {
    els.detailAgreement.textContent  = '✓ Cobus and Marius agree';
    els.detailAgreement.className    = 'detail-agreement-badge badge-agree';
  } else {
    els.detailAgreement.textContent  = '✗ Cobus and Marius disagree';
    els.detailAgreement.className    = 'detail-agreement-badge badge-disagree';
  }

  // Pieter's note
  els.detailPieterNote.value   = row.pieter_note || '';
  els.detailNoteSaved.classList.add('hidden');

  // Load metadata for grid hover
  detail.metadata = null;
  try {
    const res = await fetch(`/api/images/metadata/${state.currentSet.id}/${row.filename}`);
    detail.metadata = res.ok ? await res.json() : null;
  } catch { detail.metadata = null; }

  // Re-apply grid if it was on
  if (detail.gridEnabled && detail.metadata?.grid) {
    els.detailImgFpc.onload = () => {
      enableDetailGrid();
      els.detailImgFpc.onload = null;
    };
  }
}

function setDetailBadge(el, score) {
  if (score === null || score === undefined) {
    el.textContent = '—';
    el.className   = 'score-badge s0';
  } else {
    el.textContent = SCORE_LABELS[score] || score;
    el.className   = `score-badge ${SCORE_CLASS[score] || ''}`;
  }
}

// =====================
//  Detail grid hover
// =====================
function getDetailFpcBounds() {
  const img        = els.detailImgFpc;
  const container  = els.detailFpcContainer;
  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  const naturalW   = img.naturalWidth  || 1;
  const naturalH   = img.naturalHeight || 1;

  const scale    = Math.min(containerW / naturalW, containerH / naturalH);
  const displayW = naturalW * scale;
  const displayH = naturalH * scale;
  const offsetX  = (containerW - displayW) / 2;
  const offsetY  = (containerH - displayH) / 2;

  return { displayW, displayH, offsetX, offsetY, scale };
}

function drawDetailGridLines() {
  if (!detail.metadata?.grid) return;

  const canvas     = els.detailGridCanvas;
  const container  = els.detailFpcContainer;
  canvas.width     = container.clientWidth;
  canvas.height    = container.clientHeight;

  const bounds   = getDetailFpcBounds();
  const cellSize = detail.metadata.grid.cell_size_px;
  const cellDisp = cellSize * bounds.scale;
  const ctx      = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth   = 1;

  for (let c = 0; c * cellDisp <= bounds.displayW + 1; c++) {
    const x = bounds.offsetX + c * cellDisp;
    ctx.beginPath(); ctx.moveTo(x, bounds.offsetY);
    ctx.lineTo(x, bounds.offsetY + bounds.displayH); ctx.stroke();
  }
  for (let r = 0; r * cellDisp <= bounds.displayH + 1; r++) {
    const y = bounds.offsetY + r * cellDisp;
    ctx.beginPath(); ctx.moveTo(bounds.offsetX, y);
    ctx.lineTo(bounds.offsetX + bounds.displayW, y); ctx.stroke();
  }
}

function onDetailMouseMove(e) {
  if (!detail.metadata?.grid) return;

  const canvas = els.detailGridCanvas;
  const rect   = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const bounds = getDetailFpcBounds();

  if (
    mouseX < bounds.offsetX || mouseX > bounds.offsetX + bounds.displayW ||
    mouseY < bounds.offsetY || mouseY > bounds.offsetY + bounds.displayH
  ) {
    drawDetailGridLines();
    hideDetailTooltip();
    return;
  }

  const imgX     = (mouseX - bounds.offsetX) / bounds.scale;
  const imgY     = (mouseY - bounds.offsetY) / bounds.scale;
  const cellSize = detail.metadata.grid.cell_size_px;
  const col      = Math.floor(imgX / cellSize);
  const row      = Math.floor(imgY / cellSize);
  const cell     = detail.metadata.grid.cells.find(c => c.row === row && c.col === col);

  if (!cell) { drawDetailGridLines(); hideDetailTooltip(); return; }

  const ctx          = canvas.getContext('2d');
  const cellDisp     = cellSize * bounds.scale;
  const cellX        = bounds.offsetX + col * cellDisp;
  const cellY        = bounds.offsetY + row * cellDisp;

  drawDetailGridLines();
  ctx.save();
  ctx.fillStyle   = cell.excluded ? 'rgba(255,80,80,0.18)' : 'rgba(255,255,255,0.15)';
  ctx.fillRect(cellX, cellY, cellDisp, cellDisp);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(cellX, cellY, cellDisp, cellDisp);
  ctx.restore();

  const text = cell.excluded
    ? `Cell (${row},${col}) — Excluded`
    : `Cell (${row},${col}) — FPC: ${cell.fpc !== undefined ? cell.fpc.toFixed(1) + '%' : 'N/A'}`;

  const tip = els.detailTooltip;
  tip.textContent = text;
  tip.classList.remove('hidden');
  tip.style.left  = `${e.clientX + 14}px`;
  tip.style.top   = `${e.clientY - 28}px`;
}

function hideDetailTooltip() {
  els.detailTooltip.classList.add('hidden');
}

function enableDetailGrid() {
  drawDetailGridLines();
  els.detailGridCanvas.style.pointerEvents = 'all';
  els.detailGridCanvas.addEventListener('mousemove',  onDetailMouseMove);
  els.detailGridCanvas.addEventListener('mouseleave', onDetailMouseLeave);
}

function onDetailMouseLeave() {
  drawDetailGridLines();
  hideDetailTooltip();
}

function disableDetailGrid() {
  const canvas = els.detailGridCanvas;
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.pointerEvents = 'none';
  canvas.removeEventListener('mousemove',  onDetailMouseMove);
  canvas.removeEventListener('mouseleave', onDetailMouseLeave);
  hideDetailTooltip();
}

// =====================
//  Export (updated)
// =====================
function exportCSV() {
  if (!state.tableData.length) return;

  const header = [
    'filename', 'algorithm_score',
    'cobus_score', 'cobus_reasoning',
    'marius_score', 'marius_reasoning',
    'agree', 'avg_diff_vs_algo', 'pieter_note',
  ];
  const rows = state.tableData.map(r => [
    r.filename,
    r.algorithm_score ?? '',
    r.scores['cobus']    ?? '',
    r.reasoning['cobus'] ?? '',
    r.scores['marius']    ?? '',
    r.reasoning['marius'] ?? '',
    r.allSame ? 'yes' : (r.fullyRated ? 'no' : 'incomplete'),
    r.avgDiff !== null ? r.avgDiff.toFixed(2) : '',
    r.pieter_note ?? '',
  ]);

  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  download(`dqi-ratings-${state.currentSet.name}.csv`, csv, 'text/csv');
}

function exportJSON() {
  if (!state.tableData.length) return;
  const json = JSON.stringify(state.tableData, null, 2);
  download(`dqi-ratings-${state.currentSet.name}.json`, json, 'application/json');
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// =====================
//  Events
// =====================
function bindEvents() {
  els.btnLogout.addEventListener('click', () => {
    sessionStorage.removeItem('user');
    window.location.href = '/';
  });

  els.btnExportCsv.addEventListener('click',  exportCSV);
  els.btnExportJson.addEventListener('click', exportJSON);

  // Detail panel open/close
  els.detailClose.addEventListener('click', closeDetail);
  els.detailOverlay.addEventListener('click', closeDetail);

  document.addEventListener('keydown', e => {
    if (!els.detailPanel.classList.contains('open')) return;
    if (e.key === 'Escape')     closeDetail();
    if (e.key === 'ArrowLeft')  navigateDetail(-1);
    if (e.key === 'ArrowRight') navigateDetail(1);
  });

  // Detail navigation
  els.detailPrev.addEventListener('click', () => navigateDetail(-1));
  els.detailNext.addEventListener('click', () => navigateDetail(1));

  // Grid toggle
  els.detailToggleGrid.addEventListener('change', () => {
    detail.gridEnabled = els.detailToggleGrid.checked;
    if (detail.gridEnabled) {
      if (els.detailImgFpc.complete && els.detailImgFpc.naturalWidth > 0) {
        enableDetailGrid();
      } else {
        els.detailImgFpc.onload = () => { enableDetailGrid(); els.detailImgFpc.onload = null; };
      }
    } else {
      disableDetailGrid();
    }
  });

  // Resize: redraw grid lines when window resizes
  window.addEventListener('resize', () => {
    if (detail.gridEnabled && detail.metadata?.grid) drawDetailGridLines();
  });

  // Save Pieter's note
  els.detailSaveNote.addEventListener('click', saveDetailNote);
}

function navigateDetail(dir) {
  const next = detail.currentIndex + dir;
  if (next < 0 || next >= state.tableData.length) return;
  detail.gridEnabled = false;
  els.detailToggleGrid.checked = false;
  disableDetailGrid();
  detail.currentIndex = next;
  loadDetailImage(next);
}

async function saveDetailNote() {
  const row  = state.tableData[detail.currentIndex];
  if (!row) return;
  const note = els.detailPieterNote.value.trim();

  await fetch('/api/ratings/note', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ image_id: row.image_id, note }),
  });

  // Update local state so export reflects the new note
  state.tableData[detail.currentIndex].pieter_note = note || null;

  els.detailNoteSaved.classList.remove('hidden');
  setTimeout(() => els.detailNoteSaved.classList.add('hidden'), 2000);
}

// =====================
//  Start
// =====================
init();
