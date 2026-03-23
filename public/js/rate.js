// =====================
//  State
// =====================
const state = {
  user: null,
  sets: [],
  currentSet: null,
  images: [],
  ratings: {},      // { image_id: { score, reasoning } }
  currentIndex: 0,
  metadata: null,   // metadata.json for the current image
  showGrid: false,
  showScore: true,
};

// =====================
//  DOM refs
// =====================
const els = {
  userDisplay:        document.getElementById('user-display'),
  setNameDisplay:     document.getElementById('set-name-display'),
  progressText:       document.getElementById('progress-text'),
  progressFill:       document.getElementById('progress-fill'),
  btnLogout:          document.getElementById('btn-logout'),

  setSelectorDiv:     document.getElementById('set-selector'),
  setList:            document.getElementById('set-list'),
  noSetsMsg:          document.getElementById('no-sets-msg'),

  ratingUI:           document.getElementById('rating-ui'),
  imageList:          document.getElementById('image-list'),
  imageCounter:       document.getElementById('image-counter'),
  imageFilename:      document.getElementById('image-filename'),
  algoScoreRow:       document.getElementById('algo-score-row'),
  algoScoreBadge:     document.getElementById('algo-score-badge'),
  cvValue:            document.getElementById('cv-value'),

  imgOriginal:        document.getElementById('img-original'),
  imgFpc:             document.getElementById('img-fpc'),
  imgGrid:            document.getElementById('img-grid'),
  panelGrid:          document.getElementById('panel-grid'),
  gridPanelContainer: document.getElementById('grid-panel-container'),
  gridCanvas:         document.getElementById('grid-canvas'),
  hoverTooltip:       document.getElementById('hover-tooltip'),

  toggleGrid:         document.getElementById('toggle-grid'),
  toggleScore:        document.getElementById('toggle-score'),

  ratingBtns:         document.querySelectorAll('.rating-btn'),
  reasoning:          document.getElementById('reasoning'),

  btnPrev:            document.getElementById('btn-prev'),
  btnSkip:            document.getElementById('btn-skip'),
  btnNext:            document.getElementById('btn-next'),
  btnResetRatings:    document.getElementById('btn-reset-ratings'),
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
  // Auto-open the first (and currently only) set
  selectSet(state.sets[0]);
}

async function selectSet(set) {
  state.currentSet = set;
  els.setNameDisplay.textContent = set.name;
  els.setSelectorDiv.classList.add('hidden');
  els.ratingUI.classList.remove('hidden');

  const [imgRes, ratingsRes] = await Promise.all([
    fetch(`/api/images/set/${set.id}`),
    fetch(`/api/ratings/progress/${state.user.id}/${set.id}`)
  ]);
  state.images = await imgRes.json();
  state.ratings = await ratingsRes.json();

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

  // Counter + filename
  els.imageCounter.textContent = `${index + 1} / ${state.images.length}`;
  els.imageFilename.textContent = image.filename;

  // Algorithm score
  updateAlgoScore(image.algorithm_score);

  // Load all image panels
  updateImageSrcs();

  // Restore previous rating
  const existing = state.ratings[image.id];
  els.ratingBtns.forEach(btn => btn.classList.remove('selected'));
  if (existing) {
    const btn = document.querySelector(`.rating-btn[data-score="${existing.score}"]`);
    if (btn) btn.classList.add('selected');
    els.reasoning.value = existing.reasoning || '';
  } else {
    els.reasoning.value = '';
  }

  // Nav buttons
  els.btnPrev.disabled = index === 0;
  els.btnNext.disabled = index === state.images.length - 1;

  updateSidebar();

  // Grid canvas
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
function updateAlgoScore(score) {
  if (!state.showScore || score === null || score === undefined) {
    els.algoScoreRow.style.display = 'none';
    return;
  }
  els.algoScoreRow.style.display = '';
  const labels = { 1: '1 — Unacceptable', 2: '2 — Risk', 3: '3 — Acceptable', 4: '4 — Good' };
  els.algoScoreBadge.textContent = labels[score] || score;
  els.algoScoreBadge.className = `score-badge s${score || 0}`;
  const cv = state.metadata?.cv;
  els.cvValue.textContent = cv !== null && cv !== undefined ? `CV: ${cv}` : '';
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

  // Scroll active item into view
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

// Returns pixel bounds of the grid image within its panel container
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

  // Outside the actual image (letterbox area)
  if (
    mouseX < bounds.offsetX || mouseX > bounds.offsetX + bounds.displayW ||
    mouseY < bounds.offsetY || mouseY > bounds.offsetY + bounds.displayH
  ) {
    clearCanvas();
    hideTooltip();
    return;
  }

  // Convert to image-space coordinates
  const imgX = (mouseX - bounds.offsetX) / bounds.scale;
  const imgY = (mouseY - bounds.offsetY) / bounds.scale;

  const grid     = state.metadata.grid;
  const cellSize = grid.cell_size_px;
  const col      = Math.floor(imgX / cellSize);
  const row      = Math.floor(imgY / cellSize);

  const cell = grid.cells.find(c => c.row === row && c.col === col);
  if (!cell) { clearCanvas(); hideTooltip(); return; }

  // Highlight hovered cell
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
  // Logout
  els.btnLogout.addEventListener('click', () => {
    const rated = state.images.filter(img => state.ratings[img.id]).length;
    if (rated < state.images.length && state.images.length > 0) {
      const ok = confirm(`You have rated ${rated} of ${state.images.length} images. Leave anyway?`);
      if (!ok) return;
    }
    sessionStorage.removeItem('user');
    window.location.href = '/';
  });

  // Grid toggle — show/hide the grid panel
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

  // Score toggle — show/hide algorithm score in right panel
  els.toggleScore.addEventListener('change', () => {
    state.showScore = els.toggleScore.checked;
    const image = state.images[state.currentIndex];
    if (image) updateAlgoScore(image.algorithm_score);
  });

  // Rating buttons
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

  // Navigation
  els.btnPrev.addEventListener('click', () => {
    if (state.currentIndex > 0) showImage(state.currentIndex - 1);
  });
  els.btnNext.addEventListener('click', () => {
    if (state.currentIndex < state.images.length - 1) showImage(state.currentIndex + 1);
  });
  els.btnSkip.addEventListener('click', () => {
    if (state.currentIndex < state.images.length - 1) showImage(state.currentIndex + 1);
  });

  // Keyboard shortcuts: 1-4 to rate (disabled when typing in reasoning box)
  window.addEventListener('keydown', async (e) => {
    if (document.activeElement === els.reasoning) return;
    if (!['1','2','3','4'].includes(e.key)) return;

    const score = parseInt(e.key);
    const image = state.images[state.currentIndex];
    if (!image) return;

    els.ratingBtns.forEach(b => b.classList.remove('selected'));
    const btn = document.querySelector(`.rating-btn[data-score="${score}"]`);
    if (btn) btn.classList.add('selected');

    await submitRating(image.id, score, els.reasoning.value.trim());
  });

  // Reset all ratings for current user + current set
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

  // Warn before closing/refreshing if not all images are rated
  window.addEventListener('beforeunload', (e) => {
    if (!state.currentSet) return;
    const rated = state.images.filter(img => state.ratings[img.id]).length;
    if (rated < state.images.length) {
      e.preventDefault();
    }
  });

  // Resize: re-sync canvas
  window.addEventListener('resize', () => {
    clearCanvas();
    if (state.showGrid && state.metadata?.grid) enableGridHover();
  });
}

// =====================
//  Start
// =====================
init();
