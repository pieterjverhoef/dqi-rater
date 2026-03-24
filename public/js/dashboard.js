// =====================
//  State
// =====================
const state = {
  user:       null,
  sets:       [],
  currentSet: null,
  tableData:  [],
};

// =====================
//  DOM refs
// =====================
const els = {
  btnLogout:        document.getElementById('btn-logout'),
  btnExportCsv:     document.getElementById('btn-export-csv'),
  btnExportJson:    document.getElementById('btn-export-json'),
  btnDeepAnalysis:  document.getElementById('btn-deep-analysis'),
  setSelectorDiv:   document.getElementById('set-selector'),
  setList:          document.getElementById('set-list'),
  noSetsMsg:        document.getElementById('no-sets-msg'),
  dashContent:      document.getElementById('dash-content'),
  cardTotal:        document.getElementById('card-total'),
  cardRated:        document.getElementById('card-rated'),
  cardAgreement:    document.getElementById('card-agreement'),
  cardAvgDiff:      document.getElementById('card-avg-diff'),
  tbody:            document.getElementById('dash-tbody'),
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
  els.btnDeepAnalysis.classList.remove('hidden');

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

  rows.forEach((row) => {
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
    `;

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
//  Export
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

  els.btnDeepAnalysis.addEventListener('click', () => {
    if (!state.currentSet || !state.tableData.length) return;
    sessionStorage.setItem('deepAnalysis', JSON.stringify({
      set:       state.currentSet,
      tableData: state.tableData,
    }));
    window.location.href = '/deep-analysis.html';
  });
}

// =====================
//  Start
// =====================
init();
