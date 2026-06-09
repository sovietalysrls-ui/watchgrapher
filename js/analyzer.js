/**
 * analyzer.js v2.1 — Algoritmo corretto per TGBC piezoelettrico
 *
 * CORREZIONI v2.1:
 * - _minExpectedInterval: usa BPH reale, non moltiplicato
 * - Filtro intervalli allargato: accetta fino a 3× l'intervallo teorico
 *   (gestisce tick mancati senza sporcare la media)
 * - _detectBPH: l'intervallo tra tick consecutivi = 1 beat = 3600/BPH
 *   NON moltiplicare per 2 (ogni tick = 1 beat dello scappamento)
 * - Cooldown picchi calibrato su 18000 BPH (55ms) non 8ms
 * - Soglia adattiva più aggressiva per TGBC piezoelettrico
 * - Beat error: finestra accettazione allargata a 20ms
 */

const COMMON_BPH = [18000, 19800, 21600, 25200, 28800, 36000];
const MAX_TICK_HISTORY = 120;

export class WatchAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this.sampleRate    = 44100;
    this.bph           = 18000;
    this.liftAngle     = 51;
    this.autoDetectBPH = true;

    // Rilevamento picchi
    this._lastPeakSample  = -1;
    this._peakCooldown    = 0;
    this._threshold       = 0.005;
    this._noiseFloor      = 0.001;
    this._adaptiveGain    = 1.0;
    this._peakMax         = 0;      // picco massimo visto (per gain)

    // Storia tick
    this._tickTimes     = [];  // secondi assoluti di ogni tick (P1)
    this._tickIntervals = [];  // intervalli tra tick consecutivi (s)
    this._beatErrors    = [];  // ms
    this._deltaTs       = [];  // s, per ampiezza

    // Tick/tock alternanza
    this._lastTickSec   = -1;
    this._isTick        = true;

    // Tick in costruzione
    this._curP1         = -1;   // sample time del P1 corrente
    this._curPeaks      = [];   // { sample, amp }

    this._sampleCount   = 0;
    this.results        = this._emptyResults();
    this.calibrationOffset = 0;
    this.running        = false;
    this.startTime      = null;
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
  }

  setCalibrationOffset(v) { this.calibrationOffset = v; }

  processSamples(samples, sampleRate) {
    this.sampleRate = sampleRate;
    if (!this.running) return;

    this._updateThreshold(samples);

    for (let i = 0; i < samples.length; i++) {
      const val = Math.abs(samples[i]) * this._adaptiveGain;
      const globalSample = this._sampleCount + i;

      if (val > this._threshold && this._peakCooldown <= 0) {
        this._onPeak(globalSample, val);
        // Cooldown minimo = 20ms (evita di contare rimbalzi del piezo)
        this._peakCooldown = Math.floor(sampleRate * 0.020);
      }
      if (this._peakCooldown > 0) this._peakCooldown--;
    }

    this._sampleCount += samples.length;
    this.sampleCount   = this._sampleCount;

    // Chiudi tick in sospeso se è passato abbastanza tempo (>80% intervallo teorico)
    this._flushStaleTick();

    if (this._tickTimes.length >= 4) this._computeResults();
  }

  _updateThreshold(samples) {
    // Peak del chunk
    let peak = 0;
    let sumSq = 0;
    for (const s of samples) {
      const a = Math.abs(s);
      if (a > peak) peak = a;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / samples.length);

    // Noise floor: media mobile lenta
    this._noiseFloor = this._noiseFloor * 0.97 + rms * 0.03;

    // Soglia = 6× noise floor (TGBC ha segnale forte e netto)
    // minimo assoluto 0.003 per evitare falsi positivi in silenzio
    this._threshold = Math.max(0.003, this._noiseFloor * 6);

    // Gain adattivo: normalizza verso 0.05 di ampiezza target
    if (peak > 0) {
      this._peakMax = this._peakMax * 0.995 + peak * 0.005;
      const targetAmp = 0.05;
      this._adaptiveGain = this._peakMax > 0
        ? Math.min(50, targetAmp / this._peakMax)
        : 1.0;
    }
  }

  _beatInterval() {
    // Durata teorica di 1 beat in secondi
    return 3600 / this.bph;
  }

  _onPeak(sampleTime, amp) {
    const timeSec = sampleTime / this.sampleRate;

    // Intervallo dal picco precedente in secondi
    const sinceLast = this._lastPeakSample >= 0
      ? (sampleTime - this._lastPeakSample) / this.sampleRate
      : 999;

    // Un nuovo tick inizia se il picco è distante almeno 40% di un beat
    // dal precedente (separa tick diversi dai sotto-picchi dello stesso tick)
    const minNewTickGap = this._beatInterval() * 0.40;

    if (sinceLast >= minNewTickGap) {
      // Chiudi tick precedente
      if (this._curP1 >= 0 && this._curPeaks.length >= 1) {
        this._closeTick();
      }
      // Inizia nuovo tick
      this._curP1    = sampleTime;
      this._curPeaks = [{ sample: sampleTime, amp }];
    } else {
      // Sotto-picco dello stesso tick (P2, P3)
      if (this._curPeaks.length < 3) {
        this._curPeaks.push({ sample: sampleTime, amp });
      }
    }

    this._lastPeakSample = sampleTime;
  }

  _flushStaleTick() {
    // Se il tick in costruzione è rimasto aperto per più di 1.5 beat, chiudilo
    if (this._curP1 < 0) return;
    const age = (this._sampleCount - this._curP1) / this.sampleRate;
    if (age > this._beatInterval() * 1.5 && this._curPeaks.length >= 1) {
      this._closeTick();
    }
  }

  _closeTick() {
    const p1Sec = this._curP1 / this.sampleRate;
    const peaks = this._curPeaks;

    this._tickTimes.push(p1Sec);

    // ── Intervallo tra tick consecutivi ──
    if (this._tickTimes.length > 1) {
      const interval = p1Sec - this._tickTimes[this._tickTimes.length - 2];
      // Accetta intervalli tra 0.5× e 3.5× il beat teorico
      // (3.5× gestisce fino a 3 tick mancati consecutivi)
      const beat = this._beatInterval();
      if (interval > beat * 0.5 && interval < beat * 3.5) {
        // Normalizza: se salta 2 tick → dividi per 2, ecc.
        // Trova il divisore più plausibile
        const divisor = Math.round(interval / beat);
        if (divisor >= 1 && divisor <= 3) {
          const normalized = interval / divisor;
          this._tickIntervals.push(normalized);
          if (this._tickIntervals.length > MAX_TICK_HISTORY) this._tickIntervals.shift();
        }
      }
    }

    // ── Beat error (tick/tock) ──
    if (this._isTick) {
      this._lastTickSec = p1Sec;
    } else {
      if (this._lastTickSec > 0) {
        const halfBeat  = this._beatInterval() / 2;
        const measured  = p1Sec - this._lastTickSec;
        const beatErr   = (measured - halfBeat) * 1000; // ms
        // Accetta solo se plausibile (< 20ms)
        if (Math.abs(beatErr) < 20) {
          this._beatErrors.push(beatErr);
          if (this._beatErrors.length > MAX_TICK_HISTORY) this._beatErrors.shift();
        }
      }
    }
    this._isTick = !this._isTick;

    // ── DeltaT per ampiezza ──
    if (peaks.length >= 3) {
      const dt = (peaks[2].sample - peaks[0].sample) / this.sampleRate;
      if (dt > 0.0005 && dt < 0.060) {
        this._deltaTs.push(dt);
        if (this._deltaTs.length > MAX_TICK_HISTORY) this._deltaTs.shift();
      }
    } else if (peaks.length >= 2) {
      const dt = (peaks[1].sample - peaks[0].sample) / this.sampleRate;
      if (dt > 0.0005 && dt < 0.060) {
        this._deltaTs.push(dt);
        if (this._deltaTs.length > MAX_TICK_HISTORY) this._deltaTs.shift();
      }
    }

    if (this._tickTimes.length > MAX_TICK_HISTORY) this._tickTimes.shift();

    // Reset tick corrente
    this._curP1    = -1;
    this._curPeaks = [];
  }

  _computeResults() {
    const r      = this._emptyResults();
    r.tickCount  = this._tickTimes.length;

    const workingBPH = this.autoDetectBPH && this._tickIntervals.length >= 8
      ? this._detectBPH()
      : this.bph;

    r.bphDetected = workingBPH;
    r.rate        = this._computeRate(workingBPH);
    r.amplitude   = this._computeAmplitude(workingBPH);

    if (this._beatErrors.length >= 4) {
      r.beatError = this._trimmedMean(this._beatErrors, 0.15);
    }

    r.quality = this._computeQuality();

    if (r.rate !== null) r.rate += this.calibrationOffset;

    r.ready      = r.tickCount >= 8 && this._tickIntervals.length >= 6;
    this.results = r;
  }

  _detectBPH() {
    if (this._tickIntervals.length < 8) return this.bph;

    // _tickIntervals contiene già intervalli normalizzati a 1 beat
    // quindi BPH = 3600 / mean_interval
    const mean   = this._trimmedMean(this._tickIntervals, 0.2);
    const bphRaw = 3600 / mean;

    let best = this.bph, bestDist = Infinity;
    for (const b of COMMON_BPH) {
      const d = Math.abs(bphRaw - b);
      if (d < bestDist) { bestDist = d; best = b; }
    }

    // Accetta se entro 8% (più tollerante per orologi fuori regolazione)
    return (bestDist / best) < 0.08 ? best : this.bph;
  }

  _computeRate(bph) {
    if (this._tickIntervals.length < 6) return null;
    const mean        = this._trimmedMean(this._tickIntervals, 0.2);
    const theoretical = 3600 / bph;
    const deviation   = (mean - theoretical) / theoretical;
    return deviation * 86400; // s/giorno
  }

  _computeAmplitude(bph) {
    if (this._deltaTs.length < 4) return null;
    const deltaT = this._trimmedMean(this._deltaTs, 0.2);
    const amp    = (3600 * this.liftAngle) / (deltaT * Math.PI * bph);
    if (amp < 80 || amp > 400) return null;
    return amp;
  }

  _computeQuality() {
    if (this._tickIntervals.length < 4) return 0;
    const mean = this._trimmedMean(this._tickIntervals, 0.1);
    let variance = 0;
    for (const v of this._tickIntervals) variance += (v - mean) ** 2;
    variance /= this._tickIntervals.length;
    const cv = Math.sqrt(variance) / mean;
    const q  = Math.max(0, Math.min(100, (1 - cv / 0.04) * 100));
    return Math.round(q * Math.min(1, this._tickIntervals.length / 20));
  }

  _trimmedMean(arr, trim = 0.1) {
    if (!arr.length) return 0;
    const sorted  = [...arr].sort((a, b) => a - b);
    const cut     = Math.floor(sorted.length * trim);
    const trimmed = sorted.slice(cut, sorted.length - cut);
    if (!trimmed.length) return sorted[Math.floor(sorted.length / 2)];
    return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  }

  getPaperStripData(n = 60) { return this._tickIntervals.slice(-n); }
  start()  { this.running = true;  this.startTime = Date.now(); }
  pause()  { this.running = false; }
}
