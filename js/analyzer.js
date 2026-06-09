/**
 * analyzer.js — Algoritmo di analisi timegrapher
 *
 * ALGORITMO:
 * Ogni tick di un orologio meccanico è composto da 3 impulsi sonori:
 *   P1 = unlocking (inizio levata)
 *   P2 = impulse (contatto perno impulso/forcella)
 *   P3 = drop (caduta dente ruota scappamento)
 *
 * Rate (scarto giornaliero):
 *   Misurato dall'intervallo medio tra tick consecutivi.
 *   Se BPH atteso = 18000 → intervallo teorico = 3600/18000 = 0.200s
 *   Scarto = (intervallo_misurato - intervallo_teorico) / intervallo_teorico × 86400 s/giorno
 *
 * Beat Error:
 *   Differenza temporale tra tick e tock (ms).
 *   Ideale = 0 ms. Accettabile < 1.0 ms.
 *
 * Ampiezza:
 *   Formula: A = (3600 × liftAngle) / (ΔT × π × BPH)
 *   dove ΔT = intervallo P1-P3 in secondi.
 *   Risultato in gradi.
 *
 * BPH auto-detect:
 *   Prova i valori comuni [18000, 21600, 25200, 28800, 36000],
 *   sceglie quello che minimizza la varianza degli intervalli.
 */

const COMMON_BPH = [18000, 19800, 21600, 25200, 28800, 36000];
const MAX_TICK_HISTORY = 120; // campioni per statistiche robuste

export class WatchAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this.sampleRate = 44100;
    this.bph = 21600;           // default, sovrascrivibile
    this.liftAngle = 52;        // default, sovrascrivibile
    this.autoDetectBPH = true;

    // Buffer campioni grezzi
    this._rawBuffer = [];
    this._rawBufferSize = 44100 * 2; // 2 secondi

    // Rilevamento picchi
    this._lastPeakTime = -1;
    this._peakCooldown = 0;
    this._threshold = 0.01;
    this._noiseFloor = 0.002;
    this._adaptiveGain = 1.0;

    // Storia dei tick
    this._tickTimes = [];      // timestamp (in campioni) di P1 di ogni tick
    this._tickIntervals = [];  // intervalli tra tick consecutivi (secondi)
    this._beatErrors = [];     // differenze tick-tock (ms)
    this._deltaTs = [];        // intervalli P1-P3 per ampiezza (secondi)

    // Sub-struttura per tick/tock alternati
    this._lastTickTime = -1;
    this._lastTockTime = -1;
    this._isTick = true;       // alterna tick/tock

    // Tick corrente (per catturare P1 e P3)
    this._currentTickP1 = -1;
    this._currentTickPeaks = [];

    // Contatore campioni totali
    this._sampleCount = 0;

    // Risultati correnti
    this.results = this._emptyResults();

    // Calibrazione offset (da sync atomico)
    this.calibrationOffset = 0; // secondi/giorno

    // State
    this.running = false;
    this.sampleCount = 0;
    this.startTime = null;
  }

  _emptyResults() {
    return {
      rate: null,         // secondi/giorno
      beatError: null,    // ms
      amplitude: null,    // gradi
      bphDetected: null,  // BPH rilevato
      quality: 0,         // 0-100 qualità del segnale
      tickCount: 0,
      ready: false,
    };
  }

  configure(bph, liftAngle, autoDetect) {
    this.bph = bph;
    this.liftAngle = liftAngle;
    this.autoDetectBPH = autoDetect;
  }

  setCalibrationOffset(offsetSecPerDay) {
    this.calibrationOffset = offsetSecPerDay;
  }

  /**
   * Riceve chunk di campioni audio Float32Array
   */
  processSamples(samples, sampleRate) {
    this.sampleRate = sampleRate;
    if (!this.running) return;

    // Aggiorna soglia adattiva (noise floor)
    this._updateAdaptiveThreshold(samples);

    // Rileva picchi nel chunk
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]) * this._adaptiveGain;
      const globalTime = this._sampleCount + i; // in campioni

      if (abs > this._threshold && this._peakCooldown <= 0) {
        this._onPeak(globalTime, abs);
        // Cooldown: almeno 8 ms tra picchi dello stesso tick
        this._peakCooldown = Math.floor(sampleRate * 0.008);
      }

      if (this._peakCooldown > 0) this._peakCooldown--;
    }

    this._sampleCount += samples.length;
    this.sampleCount = this._sampleCount;

    // Ricalcola risultati ogni chunk
    if (this._tickTimes.length >= 4) {
      this._computeResults();
    }
  }

  _updateAdaptiveThreshold(samples) {
    // RMS del chunk
    let rms = 0;
    for (let s of samples) rms += s * s;
    rms = Math.sqrt(rms / samples.length);

    // Aggiorna noise floor con media mobile lenta
    this._noiseFloor = this._noiseFloor * 0.95 + rms * 0.05;

    // Soglia = 4× noise floor, ma minimo 0.005
    this._threshold = Math.max(0.005, this._noiseFloor * 4);

    // Gain adattivo: se segnale troppo debole, amplifica virtualmente
    if (this._noiseFloor < 0.001) {
      this._adaptiveGain = Math.min(20, 0.01 / Math.max(this._noiseFloor, 0.0001));
    } else {
      this._adaptiveGain = 1.0;
    }
  }

  _onPeak(sampleTime, amplitude) {
    const timeSeconds = sampleTime / this.sampleRate;
    const minIntervalSec = this._minExpectedInterval();

    // Se è il primo picco di un nuovo tick (abbastanza distante dal precedente)
    if (this._lastPeakTime < 0 ||
        (timeSeconds - this._lastPeakTime / this.sampleRate) > minIntervalSec * 0.4) {

      // Chiudi il tick precedente se aveva P1 e almeno un altro picco
      if (this._currentTickP1 >= 0 && this._currentTickPeaks.length >= 1) {
        this._closeTick(sampleTime);
      }

      // Inizia nuovo tick: P1
      this._currentTickP1 = sampleTime;
      this._currentTickPeaks = [{ time: sampleTime, amp: amplitude }];

    } else {
      // Picco successivo nello stesso tick: P2 o P3
      if (this._currentTickPeaks.length < 3) {
        this._currentTickPeaks.push({ time: sampleTime, amp: amplitude });
      }
    }

    this._lastPeakTime = sampleTime;
  }

  _closeTick(nextTickTime) {
    const p1Time = this._currentTickP1;
    const peaks = this._currentTickPeaks;

    // Registra tempo del tick (P1)
    const p1Sec = p1Time / this.sampleRate;
    this._tickTimes.push(p1Sec);

    // Intervallo dal tick precedente
    if (this._tickTimes.length > 1) {
      const interval = p1Sec - this._tickTimes[this._tickTimes.length - 2];
      // Filtra intervalli plausibili (tra 0.08s e 0.25s)
      if (interval > 0.08 && interval < 0.25) {
        this._tickIntervals.push(interval);
        if (this._tickIntervals.length > MAX_TICK_HISTORY)
          this._tickIntervals.shift();
      }
    }

    // Beat error: differenza tick/tock
    if (this._isTick) {
      this._lastTickTime = p1Sec;
    } else {
      if (this._lastTickTime > 0) {
        const halfBeat = (1 / (this.bph / 3600)) / 2; // secondi tra tick e tock ideale
        const measured = p1Sec - this._lastTickTime;
        const beatErr = (measured - halfBeat) * 1000; // in ms
        if (Math.abs(beatErr) < 10) { // filtra valori assurdi
          this._beatErrors.push(beatErr);
          if (this._beatErrors.length > MAX_TICK_HISTORY)
            this._beatErrors.shift();
        }
      }
    }
    this._isTick = !this._isTick;

    // DeltaT per ampiezza: intervallo P1-P3 (o P1-P2 se solo 2 picchi)
    if (peaks.length >= 3) {
      const deltaT = (peaks[2].time - peaks[0].time) / this.sampleRate;
      if (deltaT > 0.001 && deltaT < 0.05) {
        this._deltaTs.push(deltaT);
        if (this._deltaTs.length > MAX_TICK_HISTORY)
          this._deltaTs.shift();
      }
    } else if (peaks.length >= 2) {
      const deltaT = (peaks[1].time - peaks[0].time) / this.sampleRate;
      if (deltaT > 0.001 && deltaT < 0.05) {
        this._deltaTs.push(deltaT);
        if (this._deltaTs.length > MAX_TICK_HISTORY)
          this._deltaTs.shift();
      }
    }

    if (this._tickTimes.length > MAX_TICK_HISTORY) this._tickTimes.shift();
  }

  _minExpectedInterval() {
    // Intervallo minimo tra tick attesi (per BPH corrente)
    return (3600 / (this.bph * 1.5));
  }

  _computeResults() {
    const r = this._emptyResults();
    r.tickCount = this._tickTimes.length;

    // --- Auto-detect BPH ---
    if (this.autoDetectBPH && this._tickIntervals.length >= 8) {
      r.bphDetected = this._detectBPH();
      // Usa BPH rilevato per i calcoli
      const workingBPH = r.bphDetected || this.bph;

      // --- Rate (scarto giornaliero) ---
      r.rate = this._computeRate(workingBPH);

      // --- Ampiezza ---
      r.amplitude = this._computeAmplitude(workingBPH);
    } else {
      r.bphDetected = this.bph;
      r.rate = this._computeRate(this.bph);
      r.amplitude = this._computeAmplitude(this.bph);
    }

    // --- Beat Error ---
    if (this._beatErrors.length >= 4) {
      r.beatError = this._trimmedMean(this._beatErrors, 0.15);
    }

    // --- Qualità segnale ---
    r.quality = this._computeQuality();

    // --- Applica offset calibrazione ---
    if (r.rate !== null) {
      r.rate += this.calibrationOffset;
    }

    r.ready = r.tickCount >= 8;
    this.results = r;
  }

  _detectBPH() {
    if (this._tickIntervals.length < 8) return this.bph;

    const mean = this._trimmedMean(this._tickIntervals, 0.2);
    // BPH = 3600 / intervallo_medio (ogni beat = tick o tock)
    // Ma l'intervallo tra tick consecutivi = 2 beat
    const bphRaw = 3600 / mean;

    // Trova il BPH standard più vicino
    let best = this.bph;
    let bestDist = Infinity;
    for (const b of COMMON_BPH) {
      const d = Math.abs(bphRaw - b);
      if (d < bestDist) { bestDist = d; best = b; }
    }

    // Accetta solo se entro 5%
    return bestDist / best < 0.05 ? best : this.bph;
  }

  _computeRate(bph) {
    if (this._tickIntervals.length < 6) return null;
    const mean = this._trimmedMean(this._tickIntervals, 0.2);
    const theoretical = 3600 / bph; // intervallo teorico tra tick
    const deviation = (mean - theoretical) / theoretical;
    return deviation * 86400; // secondi/giorno
  }

  _computeAmplitude(bph) {
    if (this._deltaTs.length < 4) return null;
    const deltaT = this._trimmedMean(this._deltaTs, 0.2);
    // A = (3600 × liftAngle) / (ΔT × π × BPH)
    const amp = (3600 * this.liftAngle) / (deltaT * Math.PI * bph);
    // Valori plausibili: 150-330 gradi
    if (amp < 100 || amp > 380) return null;
    return amp;
  }

  _computeQuality() {
    if (this._tickIntervals.length < 4) return 0;

    // Varianza degli intervalli normalizzata
    const mean = this._trimmedMean(this._tickIntervals, 0.1);
    let variance = 0;
    for (const v of this._tickIntervals) variance += (v - mean) ** 2;
    variance /= this._tickIntervals.length;
    const cv = Math.sqrt(variance) / mean; // coefficiente di variazione

    // Qualità inversamente proporzionale alla varianza
    // cv < 0.002 → qualità 100, cv > 0.05 → qualità 0
    const q = Math.max(0, Math.min(100, (1 - cv / 0.05) * 100));

    // Penalizza se pochi campioni
    const sampleFactor = Math.min(1, this._tickIntervals.length / 20);
    return Math.round(q * sampleFactor);
  }

  /**
   * Trimmed mean: rimuove i `trim` peggiori da ciascun lato
   */
  _trimmedMean(arr, trim = 0.1) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const cut = Math.floor(sorted.length * trim);
    const trimmed = sorted.slice(cut, sorted.length - cut);
    if (trimmed.length === 0) return sorted[Math.floor(sorted.length / 2)];
    return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  }

  /**
   * Restituisce gli ultimi N intervalli per il paper strip
   */
  getPaperStripData(n = 60) {
    return this._tickIntervals.slice(-n);
  }

  start() {
    this.running = true;
    this.startTime = Date.now();
  }

  pause() {
    this.running = false;
  }
}
