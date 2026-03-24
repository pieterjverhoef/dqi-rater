// =====================
//  State
// =====================
const state = {
  set:          null,
  tableData:    [],
  currentIndex: 0,
  metadata:     null,
  gridEnabled:  false,
};

const SCORE_LABELS = { 1: '1 Unacceptable', 2: '2 Risk', 3: '3 Acceptable', 4: '4 Good' };
const SCORE_CLASS  = { 1: 's1', 2: 's2', 3: 's3', 4: 's4' };

// =====================
//  DOM refs
// =====================
const els = {
  btnBack:          document.getElementById('da-back'),
  imageName:        document.getElementById('da-image-name'),
  pos:              document.getElementById('da-pos'),
  btnPrev:          document.getElementById('da-prev'),
  btnNext:          document.getElementById('da-next'),

  panelOriginal:    document.getElementById('da-panel-original'),
  imgOriginal:      document.getElementById('da-img-original'),
  imgFpc:           document.getElementById('da-img-fpc'),
  fpcContainer:     document.getElementById('da-fpc-container'),
  gridCanvas:       document.getElementById('da-grid-canvas'),
  tooltip:          document.getElementById('da-tooltip'),

  toggleOriginal:   document.getElementById('da-toggle-original'),
  toggleGrid:       document.getElementById('da-toggle-grid'),

  cobusBadge:       document.getElementById('da-cobus-badge'),
  cobusReasoning:   document.getElementById('da-cobus-reasoning'),
  mariusBadge:      document.getElementById('da-marius-badge'),
  mariusReasoning:  document.getElementById('da-marius-reasoning'),
  algoBadge:        document.getElementById('da-algo-badge'),
  avgDiff:          document.getElementById('da-avg-diff'),
  agreementBadge:   document.getElementById('da-agreement-badge'),
};

// =====================
//  Init
// =====================
function init() {
  const storedUser = sessionStorage.getItem('user');
  const storedDA   = sessionStorage.getItem('deepAnalysis');
  if (!storedUser || !storedDA) { window.location.href = '/dashboard.html'; return; }

  state.set       = JSON.parse(storedDA).set;
  state.tableData = JSON.parse(storedDA).tableData;

  bindEvents();
  loadImage(0);
}

// =====================
//  Load image
// =====================
async function loadImage(idx) {
  const row = state.tableData[idx];
  if (!row) return;

  state.currentIndex = idx;

  // Header
  els.imageName.textContent = row.filename;
  els.pos.textContent       = `${idx + 1} / ${state.tableData.length}`;
  els.btnPrev.disabled      = idx === 0;
  els.btnNext.disabled      = idx === state.tableData.length - 1;

  // Images
  const base = `/uploads/${state.set.name}/${row.filename}`;
  els.imgOriginal.src = `${base}/original.jpg`;
  els.imgFpc.src      = `${base}/fpc_result.jpg`;

  // Scores
  setBadge(els.cobusBadge,  row.scores['cobus']);
  setBadge(els.mariusBadge, row.scores['marius']);
  setBadge(els.algoBadge,   row.algorithm_score);

  els.cobusReasoning.textContent  = row.reasoning['cobus']  ? `"${row.reasoning['cobus']}"` : '';
  els.mariusReasoning.textContent = row.reasoning['marius'] ? `"${row.reasoning['marius']}"` : '';

  // Avg vs Algo
  els.avgDiff.textContent = row.avgDiff !== null ? `±${row.avgDiff.toFixed(2)}` : '—';

  // Agreement
  if (!row.fullyRated) {
    els.agreementBadge.textContent = 'Incomplete';
    els.agreementBadge.className   = 'da-agreement-badge badge-neutral';
  } else if (row.allSame) {
    els.agreementBadge.textContent = '✓ Cobus and Marius agree';
    els.agreementBadge.className   = 'da-agreement-badge badge-agree';
  } else {
    els.agreementBadge.textContent = '✗ Cobus and Marius disagree';
    els.agreementBadge.className   = 'da-agreement-badge badge-disagree';
  }

  // Reset grid
  disableGrid();
  els.toggleGrid.checked = false;
  state.gridEnabled = false;

  // Fetch metadata for grid hover
  state.metadata = null;
  try {
    const res = await fetch(`/api/images/metadata/${state.set.id}/${row.filename}`);
    state.metadata = res.ok ? await res.json() : null;
  } catch { state.metadata = null; }
}

function setBadge(el, score) {
  if (score === null || score === undefined) {
    el.textContent = '—';
    el.className   = 'score-badge s0';
  } else {
    el.textContent = SCORE_LABELS[score] || score;
    el.className   = `score-badge ${SCORE_CLASS[score] || ''}`;
  }
}

// =====================
//  Grid hover
// =====================
function getFpcBounds() {
  const container  = els.fpcContainer;
  const img        = els.imgFpc;
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

function drawGridLines() {
  if (!state.metadata?.grid) return;

  const canvas    = els.gridCanvas;
  const container = els.fpcContainer;
  canvas.width    = container.clientWidth;
  canvas.height   = container.clientHeight;

  const bounds   = getFpcBounds();
  const cellSize = state.metadata.grid.cell_size_px;
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

function onMouseMove(e) {
  if (!state.metadata?.grid) return;

  const canvas = els.gridCanvas;
  const rect   = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const bounds = getFpcBounds();

  if (
    mouseX < bounds.offsetX || mouseX > bounds.offsetX + bounds.displayW ||
    mouseY < bounds.offsetY || mouseY > bounds.offsetY + bounds.displayH
  ) {
    drawGridLines();
    hideTooltip();
    return;
  }

  const imgX     = (mouseX - bounds.offsetX) / bounds.scale;
  const imgY     = (mouseY - bounds.offsetY) / bounds.scale;
  const cellSize = state.metadata.grid.cell_size_px;
  const col      = Math.floor(imgX / cellSize);
  const row      = Math.floor(imgY / cellSize);
  const cell     = state.metadata.grid.cells.find(c => c.row === row && c.col === col);

  if (!cell) { drawGridLines(); hideTooltip(); return; }

  const ctx      = canvas.getContext('2d');
  const cellDisp = cellSize * bounds.scale;
  const cellX    = bounds.offsetX + col * cellDisp;
  const cellY    = bounds.offsetY + row * cellDisp;

  drawGridLines();
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

  const tip = els.tooltip;
  tip.textContent  = text;
  tip.style.left   = `${e.clientX + 14}px`;
  tip.style.top    = `${e.clientY - 28}px`;
  tip.style.position = 'fixed';
  tip.classList.remove('hidden');
}

function onMouseLeave() {
  drawGridLines();
  hideTooltip();
}

function hideTooltip() {
  els.tooltip.classList.add('hidden');
}

function enableGrid() {
  if (!state.metadata?.grid) return;
  if (els.imgFpc.complete && els.imgFpc.naturalWidth > 0) {
    drawGridLines();
  } else {
    els.imgFpc.onload = () => { drawGridLines(); els.imgFpc.onload = null; };
  }
  els.gridCanvas.style.pointerEvents = 'all';
  els.gridCanvas.addEventListener('mousemove',  onMouseMove);
  els.gridCanvas.addEventListener('mouseleave', onMouseLeave);
}

function disableGrid() {
  const canvas = els.gridCanvas;
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.pointerEvents = 'none';
  canvas.removeEventListener('mousemove',  onMouseMove);
  canvas.removeEventListener('mouseleave', onMouseLeave);
  hideTooltip();
}

// =====================
//  Events
// =====================
function bindEvents() {
  els.btnBack.addEventListener('click', () => {
    window.location.href = '/dashboard.html';
  });

  els.btnPrev.addEventListener('click', () => navigate(-1));
  els.btnNext.addEventListener('click', () => navigate(1));

  els.toggleOriginal.addEventListener('change', () => {
    els.panelOriginal.classList.toggle('hidden', !els.toggleOriginal.checked);
  });

  els.toggleGrid.addEventListener('change', () => {
    state.gridEnabled = els.toggleGrid.checked;
    if (state.gridEnabled) {
      enableGrid();
    } else {
      disableGrid();
    }
  });

  window.addEventListener('resize', () => {
    if (state.gridEnabled) drawGridLines();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  navigate(-1);
    if (e.key === 'ArrowRight') navigate(1);
  });
}

function navigate(dir) {
  const next = state.currentIndex + dir;
  if (next < 0 || next >= state.tableData.length) return;
  // Keep original toggle state, reset grid
  els.panelOriginal.classList.toggle('hidden', !els.toggleOriginal.checked);
  loadImage(next);
}

// =====================
//  Start
// =====================
init();
