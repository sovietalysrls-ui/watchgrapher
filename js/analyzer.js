/**
 * analyzer.js v3.0 — Detector a due stadi per TGBC piezoelettrico
 *
 * ARCHITETTURA:
 *   Stadi separati evitano che i sotto-picchi di un tick (P1/P2/P3 in ~12ms)
 *   interferiscano con la misurazione degli intervalli tra tick consecutivi.
 *
 *   COARSE detector (cooldown 100ms):
 *     Rileva ogni tick/tock come singolo evento.
 *     Misura intervalli → rate e beat error.
 *
 *   FINE detector (finestra 40ms dal primo picco):
 *     Dentro ogni evento raccoglie tutti i sotto-picchi.
 *     Misura P1→P3 → ampiezza.
 *
 * SIGN CONVENTION (rate):
 *   +N s/giorno = orologio AVANZA (veloce)   → beat period < nominale
 *   -N s/giorno = orologio RITARDA (lento)   → beat period > nominale
 *   Formula corretta: rate = (nominal - mean) / nominal * 86400
 *
 * BEAT ERROR:
 *   Non richiede sapere quale picco è tick e quale è tock.
 *   Su coppie consecutive di intervalli: |a - b| * 1000 ms.
 *   In un orologio in registro a=b → beat error = 0.
 */

const COMMON_BPH     = [18000, 19800, 21600, 25200, 28800, 36000];
const MAX_HISTORY    = 120;
const FINE_WINDOW_S  = 0.035; // 35ms finestra raccolta sotto-picchi
const FINE_COOLDOWN_S = 0.005; // 5ms cooldown dentro la finestra fine

export class WatchAnalyzer {
  constructor() { this.reset(); }

  reset() {
    this.sampleRate      = 44100;
    this.bph             = 18000;
    this.liftAngle       = 51;
    this.autoDetectBPH   = true;

    // ── Soglia adattiva (NO gain, solo threshold) ──
    this._noiseFloor     = 0.0005;
    this._threshold      = 0.005;

    // ── COARSE detector ──
    this._coarseCooldown = 0;     // campioni di blocco dopo un evento
    this._coarseLastSec  = -1;    // secondi dell'ultimo evento coarse
    this._eventTimes     = [];    // secondi di ogni evento

    // ── FINE detector (dentro evento corrente) ──
    this._fineOpen       = false; // finestra fine aperta?
    this._fineStartSamp  = -1;    // campione di apertura finestra
    this._finePeaks      = [];    // [{samp, amp}] dentro finestra
    this._fineCooldown   = 0;

    // ── Dati misurati ──
    this._intervals  = [];  // s, inter-evento normalizzati
    this._beatErrors = [];  // ms
    this._deltaTs    = [];  // s, P1→P3 per ampiezza

    this._sampleCount     = 0;
    this.results          = this._emptyResults();
    this.calibrationOffset = 0;
    this.running          = false;
    this.startTime        = null;
  }

  _emptyResults() {
    return {
      rate: null, beatError: null, amplitude: null,
      bphDetected: null, quality: 0, tickCount: 0, ready: false
    };
  }

  configure(bph, liftAngle, autoDetect) {
    this.bph           = bph;
    this.liftAngle     = liftAngle;
    this.autoDetectBPH = autoDetect;
    // Ricalcola cooldown coarse in base al BPH configurato
    this._updateCoarseCooldownSamples();
  }

  _updateCoarseCooldownSamples() {
    // Cooldown = 65% del periodo di beat (sicuro per 18000-36000 BPH)
    // A 18000 BPH: beat=200ms → cooldown=130ms (evita doppio-rilevamento)
    // A 28800 BPH: beat=125ms → cooldown=81ms
    const beatSec = 3600 / this.bph;
    this._coarseCooldownSamples = Math.floor(this.sampleRate * beatSec * 0.65);
  }

  setCalibrationOffset(v) { this.calibrationOffset = v; }

  processSamples(samples, sampleRate) {
    this.sampleRate = sampleRate;
    if (!this.running) return;

    if (!this._coarseCooldownSamples) this._updateCoarseCooldownSamples();

    this._updateThreshold(samples);

    for (let i = 0; i < samples.length; i++) {
      const amp        = Math.abs(samples[i]);
      const globalSamp = this._sampleCount + i;
      const globalSec  = globalSamp / sampleRate;

      // ── FINE detector: raccoglie sotto-picchi dentro la finestra ──
      if (this._fineOpen) {
        const windowAge = (globalSamp - this._fineStartSamp) / sampleRate;
        if (windowAge > FINE_WINDOW_S) {
          // Finestra scaduta: chiudi e salva deltaT
          this._closeFineWindow();
        } else if (amp > this._threshold && this._fineCooldown <= 0) {
          this._finePeaks.push({ samp: globalSamp, amp });
          this._fineCooldown = Math.floor(sampleRate * FINE_COOLDOWN_S);
        }
        if (this._fineCooldown > 0) this._fineCooldown--;
      }

      // ── COARSE detector: rileva eventi per timing ──
      if (this._coarseCooldown <= 0 && amp > this._threshold) {
        this._onCoarseEvent(globalSamp, globalSec, amp);
        this._coarseCooldown = this._coarseCooldownSamples;
      }
      if (this._coarseCooldown > 0) this._coarseCooldown--;
    }

    this._sampleCount += samples.length;
    this.sampleCount   = this._sampleCount;

    if (this._eventTimes.length >= 4) this._computeResults();
  }

  _updateThreshold(samples) {
    let sumSq = 0, peak = 0;
    for (const s of samples) {
      const a = Math.abs(s);
      sumSq += s * s;
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sumSq / samples.length);

    // Noise floor: aggiornamento lento per stabilità
    this._noiseFloor = this._noiseFloor * 0.98 + rms * 0.02;

    // Soglia = max(8× noise floor, minimo assoluto 0.002)
    // Il fattore 8 è ottimizzato per TGBC che ha segnale impulsivo forte
    this._threshold = Math.max(0.002, this._noiseFloor * 8);
  }

  _onCoarseEvent(globalSamp, globalSec, amp) {
    // Registra evento
    this._eventTimes.push(globalSec);
    if (this._eventTimes.length > MAX_HISTORY) this._eventTimes.shift();

    // Calcola intervallo dall'evento precedente
    if (this._eventTimes.length > 1) {
      const interval = globalSec - this._eventTimes[this._eventTimes.length - 2];
      this._processInterval(interval);
    }

    // Apri finestra fine per questo evento (se non già aperta)
    if (!this._fineOpen) {
      this._fineOpen      = true;
      this._fineStartSamp = globalSamp;
      this._finePeaks     = [{ samp: globalSamp, amp }];
      this._fineCooldown  = Math.floor(this.sampleRate * FINE_COOLDOWN_S);
    }

    this._coarseLastSec = globalSec;
  }

  _processInterval(interval) {
    const nominal = 3600 / this.bph;

    // Accetta intervalli tra 0.45× e 3.5× il periodo nominale
    // 0.45× = quasi un beat (tick→tock leggermente sbilanciato)
    // 3.5× = tre beat saltati
    if (interval < nominal * 0.45 || interval > nominal * 3.5) return;

    // Normalizza: se ha saltato N beat, dividi per N
    const divisor = Math.round(interval / nominal);
    if (divisor < 1 || divisor > 3) return;

    const normalized = interval / divisor;

    // Sanity check: normalized deve essere entro 15% del nominale
    if (Math.abs(normalized - nominal) / nominal > 0.15) return;

    this._intervals.push(normalized);
    if (this._intervals.length > MAX_HISTORY) this._intervals.shift();

    // ── Beat error da coppie di intervalli consecutivi ──
    // In un orologio con beat error: alternanza corto/lungo
    // beat_error_ms = |interval[i] - interval[i-1]| * 1000
    if (this._intervals.length >= 2) {
      const prev = this._intervals[this._intervals.length - 2];
      const curr = this._intervals[this._intervals.length - 1];
      const diff = Math.abs(curr - prev) * 1000; // ms
      // Plausibile se < 8ms (altrimenti è rumore o tick saltato)
      if (diff < 8.0) {
        this._beatErrors.push(diff);
        if (this._beatErrors.length > MAX_HISTORY) this._beatErrors.shift();
      }
    }
  }

  _closeFineWindow() {
    this._fineOpen = false;
    const peaks = this._finePeaks;
    if (peaks.length >= 2) {
      const dt = (peaks[peaks.length - 1].samp - peaks[0].samp) / this.sampleRate;
      // deltaT plausibile: 1ms–40ms
      if (dt >= 0.001 && dt <= 0.040) {
        this._deltaTs.push(dt);
        if (this._deltaTs.length > MAX_HISTORY) this._deltaTs.shift();
      }
    }
    this._finePeaks = [];
  }

  _computeResults() {
    const r     = this._emptyResults();
    r.tickCount = this._eventTimes.length;

    if (this._intervals.length < 6) { this.results = r; return; }

    // BPH
    const detectedBPH = this.autoDetectBPH ? this._detectBPH() : this.bph;
    r.bphDetected = detectedBPH;

    // Rate — segno corretto: positivo = veloce
    r.rate = this._computeRate(detectedBPH);

    // Beat error
    if (this._beatErrors.length >= 4) {
      r.beatError = this._trimmedMean(this._beatErrors, 0.2);
    }

    // Ampiezza
    r.amplitude = this._computeAmplitude(detectedBPH);

    // Qualità segnale
    r.quality = this._computeQuality();

    // Offset calibrazione
    if (r.rate !== null) r.rate += this.calibrationOffset;

    r.ready      = r.tickCount >= 8 && this._intervals.length >= 6;
    this.results = r;
  }

  _detectBPH() {
    const mean   = this._trimmedMean(this._intervals, 0.2);
    const bphRaw = 3600 / mean;

    let best = this.bph, bestDist = Infinity;
    for (const b of COMMON_BPH) {
      const d = Math.abs(bphRaw - b);
      if (d < bestDist) { bestDist = d; best = b; }
    }

    return (bestDist / best) < 0.10 ? best : this.bph;
  }

  _computeRate(bph) {
    if (this._intervals.length < 6) return null;
    const mean    = this._trimmedMean(this._intervals, 0.2);
    const nominal = 3600 / bph;
    // SEGNO: nominal > mean → orologio veloce → rate POSITIVO
    return (nominal - mean) / nominal * 86400;
  }

  _computeAmplitude(bph) {
    if (this._deltaTs.length < 4) return null;
    const dt  = this._trimmedMean(this._deltaTs, 0.2);
    const amp = (3600 * this.liftAngle) / (dt * Math.PI * bph);
    return (amp >= 80 && amp <= 420) ? amp : null;
  }

  _computeQuality() {
    if (this._intervals.length < 4) return 0;
    const mean = this._trimmedMean(this._intervals, 0.1);
    let variance = 0;
    for (const v of this._intervals) variance += (v - mean) ** 2;
    variance /= this._intervals.length;
    const cv = Math.sqrt(variance) / mean;
    // cv < 0.005 → 100%, cv > 0.05 → 0%
    const q  = Math.max(0, Math.min(100, (1 - cv / 0.05) * 100));
    return Math.round(q * Math.min(1, this._intervals.length / 20));
  }

  _trimmedMean(arr, trim = 0.1) {
    if (!arr.length) return 0;
    const sorted  = [...arr].sort((a, b) => a - b);
    const cut     = Math.floor(sorted.length * trim);
    const trimmed = sorted.slice(cut, sorted.length - cut);
    if (!trimmed.length) return sorted[Math.floor(sorted.length / 2)];
    return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  }

  getPaperStripData(n = 60) { return this._intervals.slice(-n); }
  start()  { this.running = true;  this.startTime = Date.now(); }
  pause()  { this.running = false; }
}
