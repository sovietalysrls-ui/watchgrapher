/**
 * app.js v2 — Flusso ottimizzato per uso sul campo
 * Flusso: seleziona calibro (o auto) → START → verdetto in 30s
 */

import { AudioManager }       from './audio.js';
import { WatchAnalyzer }      from './analyzer.js';
import { CalibrationManager } from './calibration.js';
import { UIManager }          from './ui.js';
import { PROFILES }           from './profiles.js';

// ── Stato ──
const state = {
  profile:        'soviet',
  deviceId:       null,
  bph:            18000,
  liftAngle:      42,
  autoDetectBPH:  true,
  selectedCaliber: null,
  measuring:      false,
  updateInterval: null,
};

const audio    = new AudioManager();
const analyzer = new WatchAnalyzer();
const calib    = new CalibrationManager();
const ui       = new UIManager();

let liftAnglesDB   = null;
let allCalibers    = [];  // lista piatta di tutti i calibri
let filteredCalibers = [];

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  ui.init();

  // Carica DB
  try {
    const resp = await fetch('./data/lift-angles.json');
    liftAnglesDB = await resp.json();
    buildFlatCalibers();
  } catch (e) {
    ui.log('DB calibri non caricato', 'warn');
  }

  // Calibrazione precedente
  if (calib.load()) updateCalStatus();

  // Microfoni
  await populateMics();

  // Renderizza calibri per profilo corrente
  renderCaliberGrid('');

  // Event listeners
  setupEvents();

  // Service Worker
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

  document.getElementById('app').classList.add('boot-flash');
  ui.log('Pronto. Seleziona il calibro e premi START.', 'info');
});

// ── Calibri ──
function buildFlatCalibers() {
  allCalibers = [];
  for (const [group, data] of Object.entries(liftAnglesDB)) {
    for (const c of data.calibers) {
      allCalibers.push({ ...c, group });
    }
  }
}

function getCalibersForProfile(searchTerm) {
  const profile = state.profile;
  // In profilo soviet mostra prima soviet, in modern mostra prima modern
  // ma cerca sempre in tutto il DB
  const term = (searchTerm || '').toLowerCase().trim();

  let list = allCalibers.filter(c => {
    if (term === '') {
      // Nessuna ricerca: mostra solo il gruppo del profilo corrente
      return (profile === 'soviet' && c.group === 'soviet') ||
             (profile === 'modern' && c.group === 'swiss_japanese');
    }
    // Con ricerca: cerca in tutto il DB
    return (c.brand.toLowerCase().includes(term) ||
            c.caliber.toLowerCase().includes(term) ||
            String(c.bph).includes(term));
  });

  return list;
}

function renderCaliberGrid(searchTerm) {
  const grid = document.getElementById('caliber-grid');
  if (!grid) return;

  filteredCalibers = getCalibersForProfile(searchTerm);
  grid.innerHTML = '';

  if (!filteredCalibers.length) {
    grid.innerHTML = '<span style="color:var(--text-dim);font-size:10px;font-family:var(--font-mono);grid-column:1/-1">Nessun calibro trovato</span>';
    return;
  }

  for (const c of filteredCalibers) {
    const item = document.createElement('div');
    item.className = 'caliber-item' + (state.selectedCaliber === c ? ' selected' : '');
    item.innerHTML = `<span class="caliber-item-brand">${c.brand}</span>
                      <span class="caliber-item-cal">${c.caliber}</span>
                      <span class="caliber-item-params">${c.liftAngle}° / ${c.bph.toLocaleString()} BPH</span>`;
    item.addEventListener('click', () => selectCaliber(c));
    grid.appendChild(item);
  }
}

function selectCaliber(c) {
  state.selectedCaliber = c;
  state.bph         = c.bph;
  state.liftAngle   = c.liftAngle;
  state.autoDetectBPH = false;

  // Aggiorna badge
  const badge = document.getElementById('caliber-badge');
  if (badge) {
    badge.className = 'caliber-badge selected';
    badge.innerHTML = `
      <span class="caliber-badge-name">${c.brand} ${c.caliber}</span>
      <span class="caliber-badge-params">${c.liftAngle}° · ${c.bph.toLocaleString()} BPH</span>
      ${c.note ? `<span class="caliber-badge-note">⚠ ${c.note}</span>` : ''}
    `;
  }

  // Aggiorna campi manuali
  const bphSel = document.getElementById('bph-select');
  const liftIn = document.getElementById('lift-input');
  if (bphSel) bphSel.value = c.bph;
  if (liftIn) liftIn.value = c.liftAngle;

  // Ricarica grid (deseleziona vecchi)
  renderCaliberGrid(document.getElementById('caliber-search')?.value || '');
  // Riseleziona il nuovo nel grid
  document.querySelectorAll('.caliber-item').forEach(el => {
    const brand = el.querySelector('.caliber-item-brand')?.textContent;
    const cal   = el.querySelector('.caliber-item-cal')?.textContent;
    if (brand === c.brand && cal === c.caliber) el.classList.add('selected');
  });

  // Applica subito all'analyzer se sta girando
  if (state.measuring) analyzer.configure(state.bph, state.liftAngle, false);

  ui.log(`Calibro: ${c.brand} ${c.caliber} — ${c.liftAngle}° / ${c.bph.toLocaleString()} BPH`, 'ok');
}

function setAutoDetect() {
  state.selectedCaliber = null;
  state.autoDetectBPH   = true;

  const badge = document.getElementById('caliber-badge');
  if (badge) {
    badge.className = 'caliber-badge';
    badge.innerHTML = '<span style="color:var(--amber);font-size:11px;font-family:var(--font-mono)">⚡ AUTO-DETECT attivo — BPH rilevato automaticamente</span>';
  }

  document.querySelectorAll('.caliber-item').forEach(el => el.classList.remove('selected'));

  if (state.measuring) analyzer.configure(state.bph, state.liftAngle, true);
  ui.log('Auto-detect BPH attivo. Lift angle default per profilo.', 'info');
}

// ── Microfoni ──
async function populateMics() {
  const sel = document.getElementById('mic-select');
  if (!sel) return;
  try {
    const devices = await audio.listDevices();
    sel.innerHTML = '';
    if (!devices.length) { sel.innerHTML = '<option value="">Nessun microfono trovato</option>'; return; }

    for (const d of devices) {
      const opt = document.createElement('option');
      opt.value = d.id;
      const isTGBC = /usb.?audio|tgbc/i.test(d.label);
      opt.textContent = (isTGBC ? '★ ' : '') + d.label;
      if (isTGBC && !state.deviceId) { opt.selected = true; state.deviceId = d.id; }
      sel.appendChild(opt);
    }
    if (!state.deviceId && devices.length) state.deviceId = devices[0].id;
  } catch (e) {
    sel.innerHTML = '<option value="">Errore accesso microfono</option>';
    ui.log('Errore microfoni: ' + e.message, 'error');
  }
}

// ── Events ──
function setupEvents() {
  // Microfono
  document.getElementById('mic-select')?.addEventListener('change', e => { state.deviceId = e.target.value; });
  document.getElementById('btn-refresh-mic')?.addEventListener('click', populateMics);

  // Profilo
  document.getElementById('btn-profile-soviet')?.addEventListener('click', () => setProfile('soviet'));
  document.getElementById('btn-profile-modern')?.addEventListener('click', () => setProfile('modern'));

  // Ricerca calibro
  document.getElementById('caliber-search')?.addEventListener('input', e => {
    renderCaliberGrid(e.target.value);
  });

  // Auto-detect
  document.getElementById('btn-autodetect')?.addEventListener('click', setAutoDetect);

  // Parametri manuali toggle
  document.getElementById('btn-toggle-manual')?.addEventListener('click', () => {
    const mp  = document.getElementById('manual-params');
    const btn = document.getElementById('btn-toggle-manual');
    const open = mp.classList.toggle('hidden');
    btn.textContent = open ? '▸ parametri manuali' : '▴ parametri manuali';
  });

  // BPH / lift manuale
  document.getElementById('bph-select')?.addEventListener('change', e => {
    state.bph = parseInt(e.target.value);
    if (state.measuring) analyzer.configure(state.bph, state.liftAngle, state.autoDetectBPH);
  });
  document.getElementById('lift-input')?.addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if (v >= 30 && v <= 70) {
      state.liftAngle = v;
      if (state.measuring) analyzer.configure(state.bph, state.liftAngle, state.autoDetectBPH);
    }
  });

  // Controlli
  document.getElementById('btn-start')?.addEventListener('click', startMeasuring);
  document.getElementById('btn-stop') ?.addEventListener('click', stopMeasuring);
  document.getElementById('btn-reset')?.addEventListener('click', resetMeasuring);

  // Avanzate
  document.getElementById('advanced-toggle')?.addEventListener('click', () => {
    const sec = document.getElementById('advanced-section');
    const btn = document.getElementById('advanced-toggle');
    sec.classList.toggle('open');
    btn.classList.toggle('open');
  });

  // Calibrazione
  document.getElementById('btn-calibrate')?.addEventListener('click', openCalModal);
  document.getElementById('btn-cal-cancel')?.addEventListener('click', closeCalModal);
  document.getElementById('btn-cal-ok')?.addEventListener('click', closeCalModal);
}

function setProfile(id) {
  state.profile = id;
  ui.setProfile(id);

  document.getElementById('btn-profile-soviet')?.classList.toggle('active', id === 'soviet');
  document.getElementById('btn-profile-modern')?.classList.toggle('active', id === 'modern');

  // Lift angle default per auto-detect
  if (state.autoDetectBPH) {
    state.liftAngle = id === 'soviet' ? 42 : 52;
    const liftIn = document.getElementById('lift-input');
    if (liftIn) liftIn.value = state.liftAngle;
  }

  renderCaliberGrid(document.getElementById('caliber-search')?.value || '');
  if (analyzer.results.ready) ui.renderResults(analyzer.results);
}

// ── Misurazione ──
async function startMeasuring() {
  if (state.measuring) return;
  try {
    ui.log('Avvio acquisizione...', 'info');
    await audio.start(state.deviceId, (samples, sr) => analyzer.processSamples(samples, sr));

    const bph  = state.autoDetectBPH ? 18000 : state.bph;
    const lift = state.autoDetectBPH ? (state.profile === 'soviet' ? 42 : 52) : state.liftAngle;

    analyzer.reset();
    analyzer.configure(bph, lift, state.autoDetectBPH);
    analyzer.setCalibrationOffset(0);
    analyzer.start();

    state.measuring = true;
    setControlState(true);
    ui.startConfidenceTimer();

    state.updateInterval = setInterval(() => {
      ui.renderResults(analyzer.results);
    }, 800);

    const calInfo = state.selectedCaliber
      ? `${state.selectedCaliber.brand} ${state.selectedCaliber.caliber}`
      : 'Auto-detect';
    ui.log(`Misura avviata (${calInfo}). Attendi 30+ secondi.`, 'ok');

  } catch (e) {
    ui.log('Errore avvio: ' + (e.message || e), 'error');
  }
}

function stopMeasuring() {
  if (!state.measuring) return;
  audio.stop();
  analyzer.pause();
  clearInterval(state.updateInterval);
  ui.stopConfidenceTimer();
  state.measuring = false;
  setControlState(false);
  ui.renderResults(analyzer.results);
  ui.log(`Fermato. ${analyzer.results.tickCount} tick rilevati.`, 'info');
}

function resetMeasuring() {
  stopMeasuring();
  analyzer.reset();
  ui.clearStrip();
  ui.resetConfidence();
  ui.renderResults(analyzer.results);
  ui.log('Reset.', 'info');
}

function setControlState(measuring) {
  const btnStart = document.getElementById('btn-start');
  const btnStop  = document.getElementById('btn-stop');
  if (btnStart) btnStart.disabled = measuring;
  if (btnStop) {
    if (measuring) btnStop.classList.add('visible');
    else            btnStop.classList.remove('visible');
  }
}

// ── Calibrazione avanzata ──
function openCalModal() {
  const modal = document.getElementById('cal-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  const progress = document.getElementById('cal-progress-fill');
  const status   = document.getElementById('cal-status');
  const result   = document.getElementById('cal-result');
  const btnOk    = document.getElementById('btn-cal-ok');
  const btnCancel = document.getElementById('btn-cal-cancel');

  progress.style.width = '0%';
  status.textContent   = 'Connessione...';
  result.style.display = 'none';
  btnOk.style.display  = 'none';
  btnCancel.textContent = 'Annulla';

  calib.onProgress = (step, total, msg) => {
    progress.style.width = (step / total * 100) + '%';
    status.textContent   = msg;
  };
  calib.onComplete = (res) => {
    progress.style.width = '100%';
    status.textContent   = 'Completato.';
    result.style.display = 'block';
    result.innerHTML = `Offset: <strong>${res.offsetMs.toFixed(0)} ms</strong>
      &nbsp;·&nbsp; Latenza: <strong>${res.latencyMs.toFixed(0)} ms</strong> (${res.quality})
      &nbsp;·&nbsp; ${res.measurements}/5 misure`;
    btnOk.style.display  = 'inline-block';
    btnCancel.textContent = 'Chiudi';
    calib.save();
    updateCalStatus();
  };

  calib.calibrate(5).catch(err => {
    status.textContent    = '⚠ ' + err.message;
    btnCancel.textContent = 'Chiudi';
  });
}

function closeCalModal() {
  const m = document.getElementById('cal-modal');
  if (m) m.style.display = 'none';
}

function updateCalStatus() {
  const dot  = document.getElementById('cal-dot');
  const text = document.getElementById('cal-text');
  if (dot)  dot.className  = 'cal-dot' + (calib.calibrated ? ' calibrated' : '');
  if (text) text.textContent = calib.getStatusText();
}
