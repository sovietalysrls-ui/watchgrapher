/**
 * ui.js v2 — Rendering ottimizzato per uso sul campo
 * Verdetto grande, spiegazioni pratiche in italiano,
 * barra di confidenza, strip stabilità
 */

import { PROFILES, evaluateRate, evaluateBeatError, evaluateAmplitude, computeVerdict } from './profiles.js';

export class UIManager {
  constructor() {
    this.profile = PROFILES.soviet;
    this.canvas  = null;
    this.ctx     = null;
    this.stripHistory  = [];
    this._lastResults  = null;
    this._measureStart = null;
    this._confInterval = null;
  }

  init() {
    this.canvas = document.getElementById('paper-strip');
    this.ctx    = this.canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._drawStripIdle();
  }

  setProfile(id) {
    this.profile = PROFILES[id] || PROFILES.soviet;
    const descs = {
      soviet: 'Tol. ±30 s/g · sovietici',
      modern: 'Tol. ±10 s/g · svizzeri/JP'
    };
    this._setEl('profile-desc-short', descs[id] || '');
    if (this._lastResults?.ready) this.renderResults(this._lastResults);
  }

  startConfidenceTimer() {
    this._measureStart = Date.now();
    clearInterval(this._confInterval);
    this._confInterval = setInterval(() => this._updateConfidence(), 500);
  }

  stopConfidenceTimer() {
    clearInterval(this._confInterval);
    this._confInterval = null;
  }

  resetConfidence() {
    this.stopConfidenceTimer();
    this._measureStart = null;
    const fill = document.getElementById('confidence-fill');
    const status = document.getElementById('confidence-status');
    if (fill)   { fill.style.width = '0%'; fill.className = 'confidence-fill'; }
    if (status) { status.textContent = '— in attesa'; status.style.color = 'var(--text-dim)'; }
  }

  _updateConfidence() {
    if (!this._measureStart) return;
    const elapsed = (Date.now() - this._measureStart) / 1000; // secondi
    // 0–15s: troppo presto, 15–30s: bassa, 30–60s: media, 60–120s: buona, 120s+: ottima
    let pct, cls, text, color;
    if (elapsed < 10) {
      pct = elapsed / 10 * 20; cls = 'low';
      text = `${Math.round(elapsed)}s — troppo presto`; color = 'var(--red-alert)';
    } else if (elapsed < 30) {
      pct = 20 + (elapsed - 10) / 20 * 30; cls = 'low';
      text = `${Math.round(elapsed)}s — attendere`; color = 'var(--yellow-warn)';
    } else if (elapsed < 60) {
      pct = 50 + (elapsed - 30) / 30 * 25; cls = 'medium';
      text = `${Math.round(elapsed)}s — indicativa`; color = 'var(--yellow-warn)';
    } else if (elapsed < 120) {
      pct = 75 + (elapsed - 60) / 60 * 20; cls = 'good';
      text = `${Math.round(elapsed)}s — affidabile`; color = 'var(--green-mid)';
    } else {
      pct = 95; cls = 'good';
      text = `${Math.round(elapsed)}s — ottima stima`; color = 'var(--green-mid)';
    }

    const fill   = document.getElementById('confidence-fill');
    const status = document.getElementById('confidence-status');
    if (fill)   { fill.style.width = Math.min(100, pct) + '%'; fill.className = 'confidence-fill ' + cls; }
    if (status) { status.textContent = text; status.style.color = color; }
  }

  renderResults(results) {
    this._lastResults = results;

    // BPH e tick count
    if (results.bphDetected) this._setEl('bph-detected', results.bphDetected.toLocaleString());
    this._setEl('tick-count', results.tickCount);

    // Segnale
    this._updateSignal(results.quality);

    if (!results.ready) {
      this._setDim('val-rate'); this._setDim('val-be'); this._setDim('val-amp');
      this._clearGrade('grade-rate'); this._clearGrade('grade-be'); this._clearGrade('grade-amp');
      this._resetParamExplains();
      this._setVerdictWaiting();
      return;
    }

    // Calcola valutazioni
    const rateEval = results.rate     !== null ? evaluateRate(results.rate, this.profile)           : null;
    const beEval   = results.beatError !== null ? evaluateBeatError(results.beatError, this.profile) : null;
    const ampEval  = results.amplitude !== null ? evaluateAmplitude(results.amplitude, this.profile) : null;

    // Aggiorna display numerici
    if (results.rate !== null) {
      const sign = results.rate > 0 ? '+' : '';
      this._setMetric('val-rate', 'metric-rate', sign + results.rate.toFixed(1), rateEval);
      this._setGrade('grade-rate', rateEval);
    }
    if (results.beatError !== null) {
      this._setMetric('val-be', 'metric-be', Math.abs(results.beatError).toFixed(2), beEval);
      this._setGrade('grade-be', beEval);
    }
    if (results.amplitude !== null) {
      this._setMetric('val-amp', 'metric-amp', Math.round(results.amplitude).toString(), ampEval);
      this._setGrade('grade-amp', ampEval);
    }

    // Spiegazioni pratiche
    this._updateParamExplains(results, rateEval, beEval, ampEval);

    // Paper strip
    if (results.rate !== null) this.stripHistory.push({ deviation: results.rate, q: results.quality });
    if (this.stripHistory.length > 120) this.stripHistory.shift();
    this._drawStrip();
    this._updateStripStability();

    // Verdetto
    const verdict = computeVerdict(rateEval, beEval, ampEval, this.profile);
    this._renderVerdict(verdict, results, rateEval, beEval, ampEval);
  }

  // ── Spiegazioni pratiche ─────────────────────────────────

  _updateParamExplains(results, rateEval, beEval, ampEval) {
    const p = this.profile;

    // Rate
    if (rateEval) {
      const abs = Math.abs(results.rate);
      const sign = results.rate > 0 ? 'avanza' : 'ritarda';
      let text, cls;
      if (rateEval.grade === 'excellent') {
        text = `Perfetto. ${sign} di ${abs.toFixed(1)}s/g.`; cls = 'ok';
      } else if (rateEval.grade === 'good') {
        text = `Buono. ${sign} di ${abs.toFixed(1)}s/g.`; cls = 'ok';
      } else if (rateEval.grade === 'acceptable') {
        text = `Accettabile. ${sign} ${abs.toFixed(1)}s/g. Regolabile con il regolatore.`; cls = 'warn';
      } else if (rateEval.grade === 'poor') {
        text = `Scarso. ${sign} ${abs.toFixed(1)}s/g. Regolazione difficile, probabile oliatura necessaria.`; cls = 'warn';
      } else {
        text = `Critico. ${sign} ${abs.toFixed(0)}s/g. Problema meccanico serio o spirale.`; cls = 'alert';
      }
      this._setParamExplain('pe-rate', 'pe-rate-text', text, cls);
    }

    // Beat error
    if (beEval) {
      const abs = Math.abs(results.beatError);
      let text, cls;
      if (beEval.grade === 'excellent') {
        text = `Perfetto. Bilanciamento simmetrico.`; cls = 'ok';
      } else if (beEval.grade === 'good') {
        text = `Buono. Lieve asimmetria, non influente.`; cls = 'ok';
      } else if (beEval.grade === 'acceptable') {
        text = `${abs.toFixed(2)}ms. Leve fuori registro. Correggibile spostando il nottolino.`; cls = 'warn';
      } else if (beEval.grade === 'poor') {
        text = `${abs.toFixed(2)}ms. Fuori registro. Da correggere prima della vendita.`; cls = 'warn';
      } else {
        text = `${abs.toFixed(2)}ms. Critico. Problema alla spirale o alla forcella.`; cls = 'alert';
      }
      this._setParamExplain('pe-be', 'pe-be-text', text, cls);
    }

    // Ampiezza
    if (ampEval) {
      const amp = Math.round(results.amplitude);
      let text, cls;
      if (ampEval.grade === 'excellent') {
        text = `${amp}°. Ottima. Molla e olio in buono stato.`; cls = 'ok';
      } else if (ampEval.grade === 'good') {
        text = `${amp}°. Buona. Leggero calo di potenza, normale.`; cls = 'ok';
      } else if (ampEval.grade === 'acceptable') {
        text = `${amp}°. Accettabile ma bassa. Oliatura consigliata.`; cls = 'warn';
      } else if (ampEval.label && ampEval.label.includes('alta')) {
        text = `${amp}°. Troppo alta. Possibile problema alla spirale o shock.`; cls = 'warn';
      } else if (ampEval.grade === 'poor') {
        text = `${amp}°. Bassa. Olio esaurito o molla debole. Revisione necessaria.`; cls = 'alert';
      } else {
        text = `${amp}°. Critica. Problema grave: molla rotta, pivot usurato o olio sparito.`; cls = 'alert';
      }
      this._setParamExplain('pe-amp', 'pe-amp-text', text, cls);
    }
  }

  _setParamExplain(boxId, textId, text, cls) {
    const box  = document.getElementById(boxId);
    const textEl = document.getElementById(textId);
    if (!box || !textEl) return;
    box.className  = 'param-explain ' + (cls || '');
    textEl.className = 'pe-text ' + (cls || '');
    textEl.textContent = text;
  }

  _resetParamExplains() {
    ['pe-rate','pe-be','pe-amp'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.className = 'param-explain';
    });
    ['pe-rate-text','pe-be-text','pe-amp-text'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.className = 'pe-text'; el.textContent = '—'; }
    });
  }

  // ── Verdetto ─────────────────────────────────────────────

  _renderVerdict(verdict, results, rateEval, beEval, ampEval) {
    if (!verdict) { this._setVerdictWaiting(); return; }

    const band   = document.getElementById('verdict-band');
    const icon   = document.getElementById('verdict-icon');
    const label  = document.getElementById('verdict-label');
    const sub    = document.getElementById('verdict-sub');
    const detail = document.getElementById('verdict-detail');
    if (!band) return;

    const keys = ['keep','adjust','service','skip'];
    let key = 'waiting';
    for (const k of keys) {
      if (this.profile.verdict[k] && verdict.label === this.profile.verdict[k].label) { key = k; break; }
    }

    const icons = { keep:'✓', adjust:'⚙', service:'🔧', skip:'✗' };
    band.className  = 'verdict-main-band ' + key;
    icon.textContent = icons[key] || '?';
    label.className = 'verdict-label vl-' + key;
    label.textContent = verdict.label;
    sub.textContent  = verdict.sub;

    // Dettaglio
    const rows = this._buildDetailRows(key, verdict, results, rateEval, beEval, ampEval);
    if (rows.length) {
      detail.innerHTML = rows.map(r =>
        `<div class="vd-row"><div class="vd-dot ${r.dot}"></div><div class="vd-text">${r.text}</div></div>`
      ).join('');
      detail.className = 'verdict-detail visible ' + key;
    } else {
      detail.className = 'verdict-detail';
    }
  }

  _buildDetailRows(key, verdict, results, rateEval, beEval, ampEval) {
    const rows = [];
    const p = this.profile;

    if (key === 'keep') {
      rows.push({ dot: 'ok', text: `Rate ${results.rate !== null ? (results.rate > 0 ? '+' : '') + results.rate.toFixed(1) : '?'}s/g — <strong>${rateEval?.label || '?'}</strong>` });
      rows.push({ dot: 'ok', text: `Beat error ${results.beatError !== null ? Math.abs(results.beatError).toFixed(2) : '?'}ms — <strong>${beEval?.label || '?'}</strong>` });
      if (results.amplitude) rows.push({ dot: 'ok', text: `Ampiezza ${Math.round(results.amplitude)}° — <strong>${ampEval?.label || '?'}</strong>` });
      rows.push({ dot: 'info', text: 'Orologio in buone condizioni. Acquisto consigliato salvo difetti estetici.' });
    }

    if (key === 'adjust') {
      const worstParam = verdict.note || '';
      if (rateEval && ['poor','acceptable'].includes(rateEval.grade)) {
        rows.push({ dot: 'warn', text: `Rate ${results.rate > 0 ? '+' : ''}${results.rate?.toFixed(1)}s/g — <strong>regolazione consigliata</strong> (spostare la leva regolatrice)` });
      }
      if (beEval && ['poor','acceptable'].includes(beEval.grade)) {
        rows.push({ dot: 'warn', text: `Beat error ${Math.abs(results.beatError)?.toFixed(2)}ms — <strong>fuori registro</strong> (correggere il nottolino)` });
      }
      if (ampEval && ['poor','acceptable'].includes(ampEval.grade)) {
        rows.push({ dot: 'amber', text: `Ampiezza ${Math.round(results.amplitude)}° — <strong>oliatura consigliata</strong>` });
      }
      rows.push({ dot: 'info', text: 'Funziona ma necessita intervento. Valuta il prezzo di conseguenza.' });
    }

    if (key === 'service') {
      if (ampEval && (ampEval.grade === 'poor' || ampEval.grade === 'critical')) {
        rows.push({ dot: 'bad', text: `Ampiezza critica (${Math.round(results.amplitude)}°) — <strong>olio esaurito o pivot usurato</strong>. Revisione completa.` });
      }
      if (rateEval && rateEval.grade === 'critical') {
        rows.push({ dot: 'bad', text: `Rate fuori controllo (${results.rate > 0 ? '+' : ''}${results.rate?.toFixed(0)}s/g) — possibile problema alla spirale.` });
      }
      if (beEval && beEval.grade === 'critical') {
        rows.push({ dot: 'bad', text: `Beat error grave (${Math.abs(results.beatError)?.toFixed(2)}ms) — forcella o spirale problematici.` });
      }
      rows.push({ dot: 'amber', text: 'Revisione necessaria. Costo stimato €30–80 per orologiaio. Valuta se conveniente.' });
    }

    if (key === 'skip') {
      rows.push({ dot: 'bad', text: 'Più parametri critici contemporaneamente.' });
      rows.push({ dot: 'bad', text: 'Costo di ripristino probabilmente superiore al valore dell\'orologio.' });
      rows.push({ dot: 'info', text: 'Non acquistare a meno di prezzo stracciato per pezzi.' });
    }

    return rows;
  }

  _setVerdictWaiting() {
    const band   = document.getElementById('verdict-band');
    const icon   = document.getElementById('verdict-icon');
    const label  = document.getElementById('verdict-label');
    const sub    = document.getElementById('verdict-sub');
    const detail = document.getElementById('verdict-detail');
    if (!band) return;
    band.className   = 'verdict-main-band waiting';
    icon.textContent = '…';
    label.className  = 'verdict-label vl-waiting';
    label.textContent = 'IN ATTESA';
    sub.textContent   = 'Avvicina l\'orologio al microfono TGBC';
    if (detail) detail.className = 'verdict-detail';
  }

  // ── Stabilità strip ──────────────────────────────────────

  _updateStripStability() {
    const el = document.getElementById('strip-stability');
    if (!el || this.stripHistory.length < 8) {
      if (el) { el.textContent = '—'; el.className = 'strip-stability waiting'; }
      return;
    }
    const recent = this.stripHistory.slice(-20);
    const devs   = recent.map(p => p.deviation);
    const mean   = devs.reduce((a,b) => a+b, 0) / devs.length;
    const stdDev = Math.sqrt(devs.reduce((a,b) => a + (b-mean)**2, 0) / devs.length);

    let cls, text;
    if (stdDev < 3) {
      cls = 'stable';   text = 'STABILE';
    } else if (stdDev < 8) {
      cls = 'unstable'; text = 'VARIABILE';
    } else {
      cls = 'chaotic';  text = 'INSTABILE';
    }
    el.textContent = text;
    el.className   = 'strip-stability ' + cls;
  }

  // ── Paper Strip ──────────────────────────────────────────

  _resize() {
    const w = this.canvas.parentElement.clientWidth - 20;
    this.canvas.width  = Math.max(180, w);
    this.canvas.height = 72;
    if (this._lastResults?.ready) this._drawStrip();
    else this._drawStripIdle();
  }

  _drawStripIdle() {
    const cv = this.canvas, ctx = this.ctx;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#0c0e0c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const cy = cv.height / 2;
    ctx.beginPath();
    ctx.strokeStyle = '#1a2a18';
    ctx.setLineDash([4,6]);
    ctx.moveTo(0, cy); ctx.lineTo(cv.width, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '9px "Share Tech Mono", monospace';
    ctx.fillStyle = '#1a2a18';
    ctx.textAlign = 'center';
    ctx.fillText('AVVICINA L\'OROLOGIO AL MICROFONO', cv.width / 2, cy + 4);
  }

  _drawStrip() {
    const cv  = this.canvas, ctx = this.ctx;
    const W   = cv.width, H = cv.height, cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0c0a';
    ctx.fillRect(0, 0, W, H);

    const isSov      = this.profile.id === 'soviet';
    const maxDev     = isSov ? 40 : 20;
    const gridLines  = isSov ? [5, 15, 30] : [3, 8, 15];
    const scale      = (cy - 6) / maxDev;

    // Griglia
    for (const s of gridLines) {
      [cy - s*scale, cy + s*scale].forEach(y => {
        ctx.beginPath();
        ctx.strokeStyle = '#182018';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 8]);
        ctx.moveTo(0, y); ctx.lineTo(W, y);
        ctx.stroke();
      });
      ctx.font = '7px monospace';
      ctx.fillStyle = '#1e2e1a';
      ctx.textAlign = 'left';
      ctx.setLineDash([]);
      ctx.fillText('+' + s, 2, cy - s*scale - 1);
    }

    // Linea zero
    ctx.beginPath();
    ctx.strokeStyle = '#253a22';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.moveTo(0, cy); ctx.lineTo(W, cy);
    ctx.stroke();

    if (!this.stripHistory.length) return;

    const pts = this.stripHistory.slice(-Math.floor(W / 5));
    const step = W / Math.max(pts.length, 1);

    for (let i = 0; i < pts.length; i++) {
      const x   = i * step + step / 2;
      const dev = Math.max(-maxDev, Math.min(maxDev, pts[i].deviation));
      const y   = cy - dev * scale;

      const abs = Math.abs(pts[i].deviation);
      const thr = isSov ? { ok:10, warn:20 } : { ok:5, warn:10 };
      const col = abs > thr.warn ? '#ff3b30' : abs > thr.ok ? '#ffd60a' : '#39ff14';

      ctx.globalAlpha = 0.25 + 0.75 * (i / pts.length);
      ctx.fillStyle   = col;
      ctx.shadowColor = col;
      ctx.shadowBlur  = 3;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
  }

  // ── Helper ───────────────────────────────────────────────

  _setMetric(valId, cellId, value, evaluation) {
    const el   = document.getElementById(valId);
    const cell = document.getElementById(cellId);
    if (!el) return;

    el.textContent = value;
    el.className   = 'metric-val';

    const gradeMap = {
      excellent: '',
      good:      'lime',
      acceptable:'',
      poor:      'amber',
      critical:  'alert'
    };
    const cl = gradeMap[evaluation?.grade];
    if (cl) el.classList.add(cl);

    if (cell) {
      cell.className = 'metric';
      const borderMap = { excellent:'ok', good:'ok', acceptable:'warn', poor:'amber', critical:'alert' };
      const bc = borderMap[evaluation?.grade];
      if (bc) cell.classList.add(bc);
    }
  }

  _setDim(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = '—';
    el.className   = 'metric-val dim';
  }

  _setGrade(id, ev) {
    const el = document.getElementById(id);
    if (!el || !ev) return;
    el.textContent = ev.label;
    el.className   = 'metric-grade mg-' + ev.grade;
  }

  _clearGrade(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.className = 'metric-grade'; }
  }

  _updateSignal(quality) {
    const fill = document.getElementById('signal-fill');
    const pct  = document.getElementById('signal-pct');
    if (!fill || !pct) return;
    fill.style.width = quality + '%';
    pct.textContent  = quality + '%';
    const col = quality < 30 ? '#ff3b30' : quality < 60 ? '#ffd60a' : '#1fc600';
    fill.style.background = col;
  }

  _setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  log(msg, type = 'info') {
    const el = document.getElementById('wg-log');
    if (!el) return;
    const t = new Date().toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    el.innerHTML = `<span class="log-time">[${t}]</span> <span class="log-${type}">${msg}</span>`;
  }

  clearStrip() {
    this.stripHistory = [];
    this._drawStripIdle();
    const el = document.getElementById('strip-stability');
    if (el) { el.textContent = '—'; el.className = 'strip-stability waiting'; }
  }
}
