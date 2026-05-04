// =====================
//  State
// =====================
const state = {
  user:         null,
  sets:         [],
  currentSet:   null,
  isMoranSet:   false,
  isDqiSet:     false,
  moranVersion: 'v2',      // 'v1' | 'v2' | 'v3'
  allMetadata:  {},        // { filename: metadata } — populated for moran AND dqi sets
  rawData:      [],        // raw rows from dashboard API
  tableData:    [],        // processed rows
};

// =====================
//  DOM refs
// =====================
const els = {
  btnLogout:          document.getElementById('btn-logout'),
  btnExportCsv:       document.getElementById('btn-export-csv'),
  btnExportJson:      document.getElementById('btn-export-json'),
  btnDeepAnalysis:    document.getElementById('btn-deep-analysis'),
  setSelectorDiv:     document.getElementById('set-selector'),
  setList:            document.getElementById('set-list'),
  noSetsMsg:          document.getElementById('no-sets-msg'),
  changeSetBar:       document.getElementById('change-set-bar'),
  btnChangeSet:       document.getElementById('btn-change-set'),
  dashContent:        document.getElementById('dash-content'),
  cardTotal:          document.getElementById('card-total'),
  cardRated:          document.getElementById('card-rated'),
  cardAgreement:      document.getElementById('card-agreement'),
  cardAvgDiff:        document.getElementById('card-avg-diff'),
  tbody:              document.getElementById('dash-tbody'),
  moranVersionSelect: document.getElementById('moran-version-select'),
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
  state.currentSet  = set;
  state.isMoranSet  = false;
  state.isDqiSet    = false;
  state.allMetadata = {};
  state.moranVersion = 'v2';
  els.moranVersionSelect.value = 'v2';

  els.setSelectorDiv.classList.add('hidden');
  els.dashContent.classList.remove('hidden');
  els.btnDeepAnalysis.classList.remove('hidden');
  els.changeSetBar.classList.remove('hidden');

  // Load dashboard ratings data + images list in parallel
  const [dashRes, imgRes] = await Promise.all([
    fetch(`/api/ratings/dashboard/${set.id}`),
    fetch(`/api/images/set/${set.id}`),
  ]);
  state.rawData    = await dashRes.json();
  const imagesList = await imgRes.json();

  // Detect set type from first image metadata.
  // Primary signal: set_type field. Fallback for DQI: presence of `dqi`
  // or `cv_norm` field (only DQI metadata has those).
  if (imagesList.length > 0) {
    try {
      const res = await fetch(`/api/images/metadata/${set.id}/${imagesList[0].filename}`);
      if (res.ok) {
        const firstMeta = await res.json();
        const looksLikeDqi = firstMeta?.set_type === 'dqi'
                          || firstMeta?.dqi_composite != null
                          || firstMeta?.cv_norm != null;
        state.isDqiSet   = !!looksLikeDqi;
        state.isMoranSet = !state.isDqiSet && (firstMeta?.set_type === 'moran' || firstMeta?.morans_i != null);
      }
    } catch { /* stay false */ }
  }

  // For moran AND dqi sets: fetch all metadata in parallel (needed for the
  // extended CSV/JSON export with raw metric values)
  if (state.isMoranSet || state.isDqiSet) {
    if (state.isMoranSet) els.moranVersionSelect.classList.remove('hidden');
    else                   els.moranVersionSelect.classList.add('hidden');

    const metaResponses = await Promise.all(
      imagesList.map(img =>
        fetch(`/api/images/metadata/${set.id}/${img.filename}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );
    imagesList.forEach((img, i) => {
      state.allMetadata[img.filename] = metaResponses[i];
    });
  } else {
    els.moranVersionSelect.classList.add('hidden');
  }

  state.tableData = processData(state.rawData);
  renderTable(state.tableData);
  renderSummary(state.tableData);
}

// =====================
//  Data processing
// =====================
const MORAN_RATING_TO_SCORE = {
  'Good': 4, 'Acceptable': 3, 'Risk': 2, 'Unacceptable': 1,
};

function getAlgoScoreForRow(filename, dbAlgoScore) {
  if (state.isDqiSet) {
    // DQI set: db has algorithm_score=null (blind rating) — pull the
    // algorithm DQI from metadata so the dashboard can compare experts
    // to the algorithm's prediction.
    const meta = state.allMetadata[filename];
    if (!meta) return dbAlgoScore;
    return meta.dqi ?? dbAlgoScore;
  }
  if (!state.isMoranSet) return dbAlgoScore;
  const meta = state.allMetadata[filename];
  if (!meta) return dbAlgoScore;
  const ratingKey = `moran_rating_${state.moranVersion}`;
  const rating    = meta[ratingKey];
  return MORAN_RATING_TO_SCORE[rating] ?? dbAlgoScore;
}

function processData(raw) {
  const raters   = ['cobus', 'marius'];
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
    const algoScore   = getAlgoScoreForRow(img.filename, img.algorithm_score);
    const raterScores = raters.map(r => img.scores[r] ?? null).filter(s => s !== null);
    const fullyRated  = raterScores.length === raters.length;
    const allSame     = fullyRated && new Set(raterScores).size === 1;

    let avgDiff = null;
    if (algoScore && raterScores.length > 0) {
      const diffs = raterScores.map(s => Math.abs(s - algoScore));
      avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }

    return { ...img, algorithm_score: algoScore, fullyRated, allSame, avgDiff };
  }).sort((a, b) => a.filename.localeCompare(b.filename));
}

// =====================
//  Render table
// =====================
// Legacy 1-4 labels (cv-test-set, moran-test-set)
const SCORE_LABELS = { 1: '1 Unacceptable', 2: '2 Risk', 3: '3 Acceptable', 4: '4 Good' };
const SCORE_CLASS  = { 1: 's1', 2: 's2', 3: 's3', 4: 's4' };

// 0-5 integer (dqi-test-set)
const DQI_SCORE_LABELS = {
  0: '0 No spray',
  1: '1 Very bad',
  2: '2 Bad',
  3: '3 Moderate',
  4: '4 Good',
  5: '5 Excellent',
};
const DQI_SCORE_CLASS = {
  0: 's0', 1: 's1', 2: 's2', 3: 's3', 4: 's4', 5: 's5',
};

function scoreBadge(score) {
  if (score === null || score === undefined)
    return '<span class="score-badge s0">—</span>';
  if (state.isDqiSet) {
    const rounded = Math.round(score);
    const cls = DQI_SCORE_CLASS[rounded] || 's0';
    const lbl = DQI_SCORE_LABELS[rounded] !== undefined
      ? (Number.isInteger(score) ? DQI_SCORE_LABELS[rounded] : `${score}`)
      : score;
    return `<span class="score-badge ${cls}">${lbl}</span>`;
  }
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

  let header, rows;

  if (state.isDqiSet) {
    // Full export for DQI calibration: raw metrics, normalized values,
    // composite + algorithm DQI, plus both raters' scores and reasoning.
    header = [
      'filename', 'fpc_percent', 'threshold',
      'cv', 'cv_rating', 'cv_n_cells', 'cv_reliable',
      'morans_i', 'moran_rating_v1', 'moran_rating_v2', 'moran_rating_v3', 'moran_reliable',
      'qcr_v1', 'qcr_v1_rating', 'qcr_v2', 'qcr_v2_rating', 'qcr_v3', 'qcr_v3_rating',
      'cv_norm', 'mi_norm', 'qcr_norm',
      'dqi_composite', 'dqi_algorithm',
      'cobus_score', 'cobus_reasoning',
      'marius_score', 'marius_reasoning',
      'avg_rater_score', 'agree', 'avg_diff_vs_algo', 'pieter_note',
    ];
    rows = state.tableData.map(r => {
      const m = state.allMetadata[r.filename] || {};
      const cobusScore = r.scores['cobus'];
      const mariusScore = r.scores['marius'];
      const both = [cobusScore, mariusScore].filter(s => s !== undefined && s !== null);
      const avgRater = both.length > 0
        ? (both.reduce((a, b) => a + b, 0) / both.length).toFixed(2)
        : '';
      return [
        r.filename,
        m.fpc_percent       ?? '',
        m.threshold         ?? '',
        m.cv                ?? '',
        m.cv_rating         ?? '',
        m.cv_n_cells        ?? '',
        m.cv_reliable       ?? '',
        m.morans_i          ?? '',
        m.moran_rating_v1   ?? '',
        m.moran_rating_v2   ?? '',
        m.moran_rating_v3   ?? '',
        m.moran_reliable    ?? '',
        m.qcr_v1            ?? '',
        m.qcr_v1_rating     ?? '',
        m.qcr_v2            ?? '',
        m.qcr_v2_rating     ?? '',
        m.qcr_v3            ?? '',
        m.qcr_v3_rating     ?? '',
        m.cv_norm           ?? '',
        m.mi_norm           ?? '',
        m.qcr_norm          ?? '',
        m.dqi_composite     ?? '',
        m.dqi               ?? '',
        cobusScore          ?? '',
        r.reasoning['cobus']  ?? '',
        mariusScore         ?? '',
        r.reasoning['marius'] ?? '',
        avgRater,
        r.allSame ? 'yes' : (r.fullyRated ? 'no' : 'incomplete'),
        r.avgDiff !== null ? r.avgDiff.toFixed(2) : '',
        r.pieter_note ?? '',
      ];
    });
  } else if (state.isMoranSet) {
    header = [
      'filename',
      'morans_i', 'moran_v1', 'moran_v2', 'moran_v3',
      'moran_reliable', 'moran_n_cells', 'moran_warning',
      'fpc_percent', 'threshold',
      `algorithm_score_${state.moranVersion}`,
      'cobus_score', 'cobus_reasoning',
      'marius_score', 'marius_reasoning',
      'agree', 'avg_diff_vs_algo', 'pieter_note',
    ];
    rows = state.tableData.map(r => {
      const m = state.allMetadata[r.filename] || {};
      return [
        r.filename,
        m.morans_i ?? '',
        m.moran_rating_v1 ?? '',
        m.moran_rating_v2 ?? '',
        m.moran_rating_v3 ?? '',
        m.moran_reliable ?? '',
        m.moran_n_cells  ?? '',
        m.moran_warning  ?? '',
        (m.fpc_percent ?? m.fpc) ?? '',
        m.threshold      ?? '',
        r.algorithm_score ?? '',
        r.scores['cobus']     ?? '',
        r.reasoning['cobus']  ?? '',
        r.scores['marius']    ?? '',
        r.reasoning['marius'] ?? '',
        r.allSame ? 'yes' : (r.fullyRated ? 'no' : 'incomplete'),
        r.avgDiff !== null ? r.avgDiff.toFixed(2) : '',
        r.pieter_note ?? '',
      ];
    });
  } else {
    header = [
      'filename', 'algorithm_score',
      'cobus_score', 'cobus_reasoning',
      'marius_score', 'marius_reasoning',
      'agree', 'avg_diff_vs_algo', 'pieter_note',
    ];
    rows = state.tableData.map(r => [
      r.filename,
      r.algorithm_score ?? '',
      r.scores['cobus']     ?? '',
      r.reasoning['cobus']  ?? '',
      r.scores['marius']    ?? '',
      r.reasoning['marius'] ?? '',
      r.allSame ? 'yes' : (r.fullyRated ? 'no' : 'incomplete'),
      r.avgDiff !== null ? r.avgDiff.toFixed(2) : '',
      r.pieter_note ?? '',
    ]);
  }

  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  download(`dqi-ratings-${state.currentSet.name}.csv`, csv, 'text/csv');
}

function exportJSON() {
  if (!state.tableData.length) return;

  let output;
  if (state.isDqiSet) {
    output = state.tableData.map(r => ({
      ...r,
      dqi_metadata: state.allMetadata[r.filename] || null,
    }));
  } else if (state.isMoranSet) {
    output = state.tableData.map(r => ({
      ...r,
      moran_data: state.allMetadata[r.filename] || null,
    }));
  } else {
    output = state.tableData;
  }

  const json = JSON.stringify(output, null, 2);
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

  els.btnChangeSet.addEventListener('click', () => {
    els.dashContent.classList.add('hidden');
    els.btnDeepAnalysis.classList.add('hidden');
    els.changeSetBar.classList.add('hidden');
    els.moranVersionSelect.classList.add('hidden');
    els.setSelectorDiv.classList.remove('hidden');
    state.currentSet = null;
    loadSets();
  });

  els.btnDeepAnalysis.addEventListener('click', () => {
    if (!state.currentSet || !state.tableData.length) return;
    sessionStorage.setItem('deepAnalysis', JSON.stringify({
      set:          state.currentSet,
      tableData:    state.tableData,
      isMoranSet:   state.isMoranSet,
      allMetadata:  state.allMetadata,
    }));
    window.location.href = '/deep-analysis.html';
  });

  // Moran version dropdown
  els.moranVersionSelect.addEventListener('change', () => {
    state.moranVersion = els.moranVersionSelect.value;
    state.tableData    = processData(state.rawData);
    renderTable(state.tableData);
    renderSummary(state.tableData);
  });
}

// =====================
//  Start
// =====================
init();
