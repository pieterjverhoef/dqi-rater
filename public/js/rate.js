// =====================
//  State
// =====================
const state = {
  user: null,
  sets: [],
  currentSet: null,
  isMoranSet: false,
  isDqiSet: false,
  images: [],
  ratings: {},      // { image_id: { score, reasoning } }
  currentIndex: 0,
  metadata: null,   // metadata.json for the current image
  showGrid: false,
  showScore: false,
};

// =====================
//  DOM refs
// =====================
const els = {
  userDisplay:          document.getElementById('user-display'),
  setNameDisplay:       document.getElementById('set-name-display'),
  progressText:         document.getElementById('progress-text'),
  progressFill:         document.getElementById('progress-fill'),
  headerCenter:         document.getElementById('header-center'),
  btnLogout:            document.getElementById('btn-logout'),

  setSelectorDiv:       document.getElementById('set-selector'),
  setList:              document.getElementById('set-list'),
  noSetsMsg:            document.getElementById('no-sets-msg'),

  imageSidebar:         document.getElementById('image-sidebar'),
  imagePanel:           document.getElementById('image-panel'),

  ratingUI:             document.getElementById('rating-ui'),
  btnChangeSet:         document.getElementById('btn-change-set'),
  imageList:            document.getElementById('image-list'),
  imageCounter:         document.getElementById('image-counter'),
  imageFilename:        document.getElementById('image-filename'),
  algoScoreRow:         document.getElementById('algo-score-row'),
  algoScoreBadge:       document.getElementById('algo-score-badge'),
  cvValue:              document.getElementById('cv-value'),
  moranVersionTooltip:  document.getElementById('moran-version-tooltip'),
  moranTtV1:            document.getElementById('moran-tt-v1'),
  moranTtV2:            document.getElementById('moran-tt-v2'),
  moranTtV3:            document.getElementById('moran-tt-v3'),

  imgOriginal:          document.getElementById('img-original'),
  imgFpc:               document.getElementById('img-fpc'),
  imgGrid:              document.getElementById('img-grid'),
  panelOriginal:        document.getElementById('panel-original'),
  panelGrid:            document.getElementById('panel-grid'),
  gridPanelContainer:   document.getElementById('grid-panel-container'),
  gridCanvas:           document.getElementById('grid-canvas'),
  hoverTooltip:         document.getElementById('hover-tooltip'),

  toggleOriginal:       document.getElementById('toggle-original'),
  toggleGrid:           document.getElementById('toggle-grid'),
  toggleScore:          document.getElementById('toggle-score'),

  ratingBtns:           document.querySelectorAll('.rating-btn'),
  ratingBtnsDqi:        document.querySelectorAll('.rating-btn-dqi'),
  ratingBlockLegacy:    document.getElementById('rating-buttons-legacy'),
  ratingBlockDqi:       document.getElementById('rating-buttons-dqi'),
  reasoning:            document.getElementById('reasoning'),

  btnPrev:              document.getElementById('btn-prev'),
  btnSkip:              document.getElementById('btn-skip'),
  btnNext:              document.getElementById('btn-next'),
  btnResetRatings:      document.getElementById('btn-reset-ratings'),
};

// =====================
//  Init
// =====================
async function init() {
  const stored = sessionStorage.getItem('user');
  if (!stored) { window.location.href = '/'; return; }
  state.user = JSON.parse(stored);
  els.userDisplay.textContent = state.user.username;
  await loadSets();
  bindEvents();
}

// =====================
//  API calls
// =====================
async function loadSets() {
  const res = await fetch('/api/images/sets');
  state.sets = await res.json();

  if (state.sets.length === 0) {
    els.noSetsMsg.classList.remove('hidden');
    return;
  }

  if (state.sets.length === 1) {
    selectSet(state.sets[0]);
    return;
  }

  // Multiple sets: show selector buttons
  els.setList.innerHTML = '';
  for (const set of state.sets) {
    const btn = document.createElement('button');
    btn.className = 'set-list-btn';
    btn.textContent = set.name;
    btn.addEventListener('click', () => selectSet(set));
    els.setList.appendChild(btn);
  }
}

function showSetSelector() {
  state.currentSet = null;
  els.setSelectorDiv.classList.remove('hidden');
  els.ratingUI.classList.add('hidden');
  els.imageSidebar.style.display = 'none';
  els.imagePanel.style.display   = 'none';
  els.headerCenter.style.display = 'none';
  els.setNameDisplay.textContent = '';
}

async function selectSet(set) {
  state.currentSet = set;
  state.isMoranSet = false;
  state.isDqiSet   = false;
  els.setNameDisplay.textContent = set.name;
  els.setSelectorDiv.classList.add('hidden');
  els.ratingUI.classList.remove('hidden');
  els.imageSidebar.style.display = '';
  els.imagePanel.style.display   = '';
  els.headerCenter.style.display = '';

  const [imgRes, ratingsRes] = await Promise.all([
    fetch(`/api/images/set/${set.id}`),
    fetch(`/api/ratings/progress/${state.user.id}/${set.id}`)
  ]);
  state.images = await imgRes.json();
  state.ratings = await ratingsRes.json();

  // Detect set type from first image metadata
  if (state.images.length > 0) {
    try {
      const res = await fetch(`/api/images/metadata/${set.id}/${state.images[0].filename}`);
      if (res.ok) {
        const firstMeta = await res.json();
        state.isDqiSet   = firstMeta?.set_type === 'dqi';
        state.isMoranSet = !state.isDqiSet && (firstMeta?.set_type === 'moran' || firstMeta?.morans_i != null);
      }
    } catch { /* stay false */ }
  }

  // Show the right rating-button block (legacy 1-4 vs DQI 0-5 with halves)
  if (state.isDqiSet) {
    els.ratingBlockLegacy.classList.add('hidden');
    els.ratingBlockDqi.classList.remove('hidden');
  } else {
    els.ratingBlockLegacy.classList.remove('hidden');
    els.ratingBlockDqi.classList.add('hidden');
  }

  // Apply toggle defaults based on set type
  if (state.isDqiSet) {
    // DQI set: blind rating — image only, no algorithm score, no grid by default
    els.toggleOriginal.checked = false;
    els.toggleGrid.checked = false;
    els.toggleScore.checked = false;
    state.showGrid  = false;
    state.showScore = false;
    els.panelOriginal.style.display = 'none';
    els.panelGrid.style.display     = 'none';
  } else if (state.isMoranSet) {
    // Moran set: all toggles off
    els.toggleOriginal.checked = false;
    els.toggleGrid.checked = false;
    els.toggleScore.checked = false;
    state.showGrid  = false;
    state.showScore = false;
    els.panelOriginal.style.display = 'none';
    els.panelGrid.style.display     = 'none';
  } else {
    // CV set: score ON by default, others off
    els.toggleOriginal.checked = false;
    els.toggleGrid.checked = false;
    els.toggleScore.checked = true;
    state.showGrid  = false;
    state.showScore = true;
    els.panelOriginal.style.display = 'none';
    els.panelGrid.style.display     = 'none';
  }

  const firstUnrated = state.images.findIndex(img => !state.ratings[img.id]);
  state.currentIndex = firstUnrated >= 0 ? firstUnrated : 0;

  buildSidebar();
  showImage(state.currentIndex);
  updateProgress();
}

async function loadMetadata(image) {
  if (!image || !state.currentSet) { state.metadata = null; return; }
  try {
    const res = await fetch(`/api/images/metadata/${state.currentSet.id}/${image.filename}`);
    state.metadata = res.ok ? await res.json() : null;
  } catch {
    state.metadata = null;
  }
}

async function submitRating(imageId, score, reasoning) {
  await fetch('/api/ratings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: state.user.id, image_id: imageId, score, reasoning })
  });
  state.ratings[imageId] = { score, reasoning };
  updateProgress();
  updateSidebar();
}

// =====================
//  Show image
// =====================
async function showImage(index) {
  if (state.images.length === 0) return;
  state.currentIndex = index;

  const image = state.images[index];
  await loadMetadata(image);

  els.imageCounter.textContent = `${index + 1} / ${state.images.length}`;
  els.imageFilename.textContent = image.filename;

  updateAlgoScore(image.algorithm_score);
  updateImageSrcs();

  const existing = state.ratings[image.id];
  els.ratingBtns.forEach(btn => btn.classList.remove('selected'));
  els.ratingBtnsDqi.forEach(btn => btn.classList.remove('selected'));
  if (existing) {
    const selector = state.isDqiSet ? '.rating-btn-dqi' : '.rating-btn';
    const btn = document.querySelector(`${selector}[data-score="${existing.score}"]`);
    if (btn) btn.classList.add('selected');
    els.reasoning.value = existing.reasoning || '';
  } else {
    els.reasoning.value = '';
  }

  els.btnPrev.disabled = index === 0;
  els.btnNext.disabled = index === state.images.length - 1;

  updateSidebar();

  clearCanvas();
  if (state.showGrid && state.metadata?.grid) {
    enableGridHover();
  } else {
    disableGridHover();
  }
}

function updateImageSrcs() {
  const image = state.images[state.currentIndex];
  if (!image || !state.currentSet) return;
  const base = `/uploads/${state.currentSet.name}/${image.filename}`;
  els.imgOriginal.src = `${base}/original.jpg`;
  els.imgFpc.src      = `${base}/fpc_result.jpg`;
  els.imgGrid.src     = `${base}/grid_overlay.jpg`;
}

// =====================
//  Algorithm score
// =====================
const SCORE_LABELS = { 1: '1 — Unacceptable', 2: '2 — Risk', 3: '3 — Acceptable', 4: '4 — Good' };

const MORAN_RATING_COLOR = {
  'Good':         '#2ecc71',
  'Acceptable':   '#27ae60',
  'Risk':         '#e67e22',
  'Unacceptable': '#e74c3c',
};

const MORAN_RATING_TO_SCORE = {
  'Good': 4, 'Acceptable': 3, 'Risk': 2, 'Unacceptable': 1,
};

function updateAlgoScore(score) {
  // Always hide tooltip when refreshing
  els.moranVersionTooltip.classList.add('hidden');

  // For DQI sets the DB column algorithm_score is null (blind rating).
  // When the rater toggles "Show Algorithm Score" ON, fall back to the
  // algorithm DQI from metadata so something useful shows up.
  if (state.isDqiSet) {
    if (!state.showScore) {
      els.algoScoreRow.style.display = 'none';
      return;
    }
    const dqi = state.metadata?.dqi;
    if (dqi === null || dqi === undefined) {
      els.algoScoreRow.style.display = 'none';
      return;
    }
    els.algoScoreRow.style.display = '';
    const cls = `s${Math.round(dqi)}`;
    els.algoScoreBadge.className = `score-badge ${cls}`;
    els.algoScoreBadge.textContent = `DQI: ${Number(dqi).toFixed(1)} / 5`;
    els.cvValue.textContent = '';
    return;
  }

  if (!state.showScore || score === null || score === undefined) {
    els.algoScoreRow.style.display = 'none';
    return;
  }

  els.algoScoreRow.style.display = '';
  els.algoScoreBadge.className   = `score-badge s${score || 0}`;

  if (state.isMoranSet && state.metadata) {
    // For moran sets use the moran rating label directly so badge and tooltip match
    const moranLabel = state.metadata.moran_rating_v2 || SCORE_LABELS[score] || score;
    els.algoScoreBadge.textContent = `${score} — ${moranLabel}`;
    const m  = state.metadata;
    const mi = m.morans_i !== null && m.morans_i !== undefined
      ? ` (I: ${Number(m.morans_i).toFixed(4)})` : '';

    els.moranTtV1.textContent = `V1: ${m.moran_rating_v1 || '—'}${mi}`;
    els.moranTtV2.textContent = `V2: ${m.moran_rating_v2 || '—'}${mi}  ← current`;
    els.moranTtV3.textContent = `V3: ${m.moran_rating_v3 || '—'}${mi}`;

    // Colour each line by rating
    [
      [els.moranTtV1, m.moran_rating_v1],
      [els.moranTtV2, m.moran_rating_v2],
      [els.moranTtV3, m.moran_rating_v3],
    ].forEach(([el, rating]) => {
      el.style.color = MORAN_RATING_COLOR[rating] || '#e0e0e0';
    });

    els.cvValue.textContent = '';  // no CV for moran set
  } else {
    // CV set — use the expert scale labels
    els.algoScoreBadge.textContent = SCORE_LABELS[score] || score;
    const cv = state.metadata?.cv;
    els.cvValue.textContent = cv !== null && cv !== undefined ? `CV: ${cv}` : '';
  }
}

// =====================
//  Image sidebar
// =====================
function buildSidebar() {
  els.imageList.innerHTML = '';
  state.images.forEach((image, index) => {
    const li = document.createElement('li');

    const check = document.createElement('span');
    check.className = 'img-check';

    const name = document.createElement('span');
    name.className = 'img-name';
    name.textContent = image.filename;
    name.title = image.filename;

    li.appendChild(check);
    li.appendChild(name);
    li.addEventListener('click', () => showImage(index));
    li.dataset.index = index;

    els.imageList.appendChild(li);
  });
  updateSidebar();
}

function updateSidebar() {
  const items = els.imageList.querySelectorAll('li');
  items.forEach((li, index) => {
    const image   = state.images[index];
    const isRated = !!state.ratings[image.id];
    const isActive = index === state.currentIndex;

    li.classList.toggle('active', isActive);
    li.classList.toggle('rated', isRated && !isActive);

    const check = li.querySelector('.img-check');
    check.textContent = isRated ? '✓' : '';
  });

  const activeLi = els.imageList.querySelector('li.active');
  if (activeLi) activeLi.scrollIntoView({ block: 'nearest' });
}

// =====================
//  Progress
// =====================
function updateProgress() {
  const total = state.images.length;
  const done  = state.images.filter(img => state.ratings[img.id]).length;
  els.progressText.textContent = `${done} / ${total} rated`;
  els.progressFill.style.width = total > 0 ? `${(done / total) * 100}%` : '0%';
}

// =====================
//  Grid hover (canvas on grid panel)
// =====================
function enableGridHover() {
  els.gridCanvas.classList.add('interactive');
  els.gridCanvas.addEventListener('mousemove', onGridMouseMove);
  els.gridCanvas.addEventListener('mouseleave', onGridMouseLeave);
}

function disableGridHover() {
  els.gridCanvas.classList.remove('interactive');
  els.gridCanvas.removeEventListener('mousemove', onGridMouseMove);
  els.gridCanvas.removeEventListener('mouseleave', onGridMouseLeave);
  hideTooltip();
}

function clearCanvas() {
  const canvas = els.gridCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width  = els.gridPanelContainer.clientWidth;
  canvas.height = els.gridPanelContainer.clientHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getGridImageBounds() {
  const img        = els.imgGrid;
  const containerW = els.gridPanelContainer.clientWidth;
  const containerH = els.gridPanelContainer.clientHeight;
  const naturalW   = img.naturalWidth  || 1;
  const naturalH   = img.naturalHeight || 1;

  const scale    = Math.min(containerW / naturalW, containerH / naturalH);
  const displayW = naturalW * scale;
  const displayH = naturalH * scale;
  const offsetX  = (containerW - displayW) / 2;
  const offsetY  = (containerH - displayH) / 2;

  return { displayW, displayH, offsetX, offsetY, scale };
}

function onGridMouseMove(e) {
  if (!state.metadata?.grid) return;

  const canvas = els.gridCanvas;
  const rect   = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const bounds = getGridImageBounds();

  if (
    mouseX < bounds.offsetX || mouseX > bounds.offsetX + bounds.displayW ||
    mouseY < bounds.offsetY || mouseY > bounds.offsetY + bounds.displayH
  ) {
    clearCanvas();
    hideTooltip();
    return;
  }

  const imgX = (mouseX - bounds.offsetX) / bounds.scale;
  const imgY = (mouseY - bounds.offsetY) / bounds.scale;

  const grid     = state.metadata.grid;
  const cellSize = grid.cell_size_px;
  const col      = Math.floor(imgX / cellSize);
  const row      = Math.floor(imgY / cellSize);

  const cell = grid.cells.find(c => c.row === row && c.col === col);
  if (!cell) { clearCanvas(); hideTooltip(); return; }

  const ctx             = canvas.getContext('2d');
  clearCanvas();
  const cellDisplaySize = cellSize * bounds.scale;
  const cellX           = bounds.offsetX + col * cellDisplaySize;
  const cellY           = bounds.offsetY + row * cellDisplaySize;

  ctx.save();
  ctx.fillStyle   = cell.excluded ? 'rgba(255, 80, 80, 0.18)' : 'rgba(255, 255, 255, 0.15)';
  ctx.fillRect(cellX, cellY, cellDisplaySize, cellDisplaySize);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(cellX, cellY, cellDisplaySize, cellDisplaySize);
  ctx.restore();

  const tooltipText = cell.excluded
    ? `Cell (${row},${col}) — Excluded`
    : `Cell (${row},${col}) — FPC: ${cell.fpc !== undefined ? cell.fpc.toFixed(1) + '%' : 'N/A'}`;

  showTooltip(e.clientX, e.clientY, tooltipText);
}

function onGridMouseLeave() {
  clearCanvas();
  hideTooltip();
}

function showTooltip(x, y, text) {
  const tip = els.hoverTooltip;
  tip.textContent = text;
  tip.classList.remove('hidden');
  tip.style.left = `${x + 14}px`;
  tip.style.top  = `${y - 28}px`;
}

function hideTooltip() {
  els.hoverTooltip.classList.add('hidden');
}

// =====================
//  Event bindings
// =====================
function bindEvents() {
  els.btnLogout.addEventListener('click', () => {
    const rated = state.images.filter(img => state.ratings[img.id]).length;
    if (rated < state.images.length && state.images.length > 0) {
      const ok = confirm(`You have rated ${rated} of ${state.images.length} images. Leave anyway?`);
      if (!ok) return;
    }
    sessionStorage.removeItem('user');
    window.location.href = '/';
  });

  els.btnChangeSet.addEventListener('click', () => {
    showSetSelector();
    loadSets();
  });

  els.toggleOriginal.addEventListener('change', () => {
    els.panelOriginal.style.display = els.toggleOriginal.checked ? '' : 'none';
  });

  els.toggleGrid.addEventListener('change', () => {
    state.showGrid = els.toggleGrid.checked;
    els.panelGrid.style.display = state.showGrid ? '' : 'none';
    clearCanvas();
    if (state.showGrid && state.metadata?.grid) {
      enableGridHover();
    } else {
      disableGridHover();
    }
  });

  els.toggleScore.addEventListener('change', () => {
    state.showScore = els.toggleScore.checked;
    const image = state.images[state.currentIndex];
    if (image) updateAlgoScore(image.algorithm_score);
  });

  // Moran tooltip: show on hover over the algo score badge
  els.algoScoreBadge.addEventListener('mouseenter', () => {
    if (state.isMoranSet && state.showScore && state.metadata) {
      els.moranVersionTooltip.classList.remove('hidden');
    }
  });
  els.algoScoreBadge.addEventListener('mouseleave', (e) => {
    // Keep open if moving into the tooltip itself
    if (!els.moranVersionTooltip.contains(e.relatedTarget)) {
      els.moranVersionTooltip.classList.add('hidden');
    }
  });
  els.moranVersionTooltip.addEventListener('mouseleave', () => {
    els.moranVersionTooltip.classList.add('hidden');
  });

  // Rating buttons (legacy 1-4)
  els.ratingBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const score = parseInt(btn.dataset.score);
      const image = state.images[state.currentIndex];
      if (!image) return;
      els.ratingBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      await submitRating(image.id, score, els.reasoning.value.trim());
    });
  });

  // Rating buttons (DQI 0-5 integer)
  els.ratingBtnsDqi.forEach(btn => {
    btn.addEventListener('click', async () => {
      const score = parseInt(btn.dataset.score);
      const image = state.images[state.currentIndex];
      if (!image) return;
      els.ratingBtnsDqi.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      await submitRating(image.id, score, els.reasoning.value.trim());
    });
  });

  els.btnPrev.addEventListener('click', () => {
    if (state.currentIndex > 0) showImage(state.currentIndex - 1);
  });
  els.btnNext.addEventListener('click', () => {
    if (state.currentIndex < state.images.length - 1) showImage(state.currentIndex + 1);
  });
  els.btnSkip.addEventListener('click', () => {
    if (state.currentIndex < state.images.length - 1) showImage(state.currentIndex + 1);
  });

  window.addEventListener('keydown', async (e) => {
    if (document.activeElement === els.reasoning) return;

    const image = state.images[state.currentIndex];
    if (!image) return;

    if (state.isDqiSet) {
      // DQI: 0-5 integer keys
      if (!['0','1','2','3','4','5'].includes(e.key)) return;
      const score = parseInt(e.key);

      els.ratingBtnsDqi.forEach(b => b.classList.remove('selected'));
      const btn = document.querySelector(`.rating-btn-dqi[data-score="${score}"]`);
      if (btn) btn.classList.add('selected');
      await submitRating(image.id, score, els.reasoning.value.trim());
    } else {
      // Legacy 1-4
      if (!['1','2','3','4'].includes(e.key)) return;
      const score = parseInt(e.key);

      els.ratingBtns.forEach(b => b.classList.remove('selected'));
      const btn = document.querySelector(`.rating-btn[data-score="${score}"]`);
      if (btn) btn.classList.add('selected');
      await submitRating(image.id, score, els.reasoning.value.trim());
    }
  });

  els.btnResetRatings.addEventListener('click', async () => {
    const rated = state.images.filter(img => state.ratings[img.id]).length;
    if (rated === 0) { alert('No ratings to remove.'); return; }

    const ok = confirm(`This will permanently delete all ${rated} of your ratings for this set. Are you sure?`);
    if (!ok) return;

    await fetch(`/api/ratings/${state.user.id}/${state.currentSet.id}`, { method: 'DELETE' });

    state.ratings = {};
    updateProgress();
    buildSidebar();
    showImage(0);
  });

  window.addEventListener('beforeunload', (e) => {
    if (!state.currentSet) return;
    const rated = state.images.filter(img => state.ratings[img.id]).length;
    if (rated < state.images.length) {
      e.preventDefault();
    }
  });

  window.addEventListener('resize', () => {
    clearCanvas();
    if (state.showGrid && state.metadata?.grid) enableGridHover();
  });
}

// =====================
//  Start
// =====================
init();
