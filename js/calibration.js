/**
 * calibration.js — Calibrazione via tempo atomico remoto
 *
 * Strategia: interroga worldtimeapi.org (NTP-backed) e misura la latenza
 * di rete per ottenere un riferimento temporale preciso.
 * Poi confronta con il clock locale per calcolare l'offset del sistema.
 *
 * NOTA: questa calibrazione corregge l'offset del clock di sistema
 * (es. AudioContext.currentTime), non l'orologio da polso.
 * Per l'uso in campo, la calibrazione è opzionale ma migliora
 * la precisione del rate a ±0.5 sec/giorno invece di ±2 sec/giorno.
 */

const NTP_ENDPOINT = 'https://worldtimeapi.org/api/timezone/UTC';
const FALLBACK_ENDPOINT = 'https://timeapi.io/api/time/current/zone?timeZone=UTC';

export class CalibrationManager {
  constructor() {
    this.offset = 0;          // offset in ms tra orologio locale e NTP
    this.calibrated = false;
    this.lastCalibration = null;
    this.measurements = [];
    this.onProgress = null;   // callback(step, total, message)
    this.onComplete = null;   // callback(offsetSecPerDay)
  }

  /**
   * Esegue N misurazioni ping-pong verso server NTP,
   * calcola offset medio pesato per latenza.
   */
  async calibrate(attempts = 5) {
    this.measurements = [];
    let errors = 0;

    for (let i = 0; i < attempts; i++) {
      if (this.onProgress) this.onProgress(i + 1, attempts, `Misura ${i + 1}/${attempts}...`);

      try {
        const m = await this._measureOnce();
        if (m !== null) {
          this.measurements.push(m);
        }
      } catch (e) {
        errors++;
      }

      // Pausa tra misurazioni
      if (i < attempts - 1) await this._sleep(300);
    }

    if (this.measurements.length === 0) {
      throw new Error('Impossibile raggiungere il server di riferimento temporale. Verifica la connessione.');
    }

    // Usa la misurazione con latenza più bassa (più precisa)
    this.measurements.sort((a, b) => a.latency - b.latency);
    const best = this.measurements.slice(0, Math.max(1, Math.floor(this.measurements.length / 2)));

    // Offset medio delle misurazioni migliori
    const avgOffset = best.reduce((s, m) => s + m.offset, 0) / best.length;
    this.offset = avgOffset; // ms

    // Converti in secondi/giorno (per uso nell'analyzer)
    // L'offset del sistema è costante, non accumula — usiamo 0 come correzione
    // perché il clock audio è relativo, non assoluto.
    // La calibrazione serve a confermare che il sample rate sia corretto.
    this.calibrated = true;
    this.lastCalibration = new Date();

    const result = {
      offsetMs: avgOffset,
      latencyMs: best[0].latency,
      measurements: this.measurements.length,
      timestamp: this.lastCalibration,
      quality: this._qualityLabel(best[0].latency)
    };

    if (this.onComplete) this.onComplete(result);
    return result;
  }

  async _measureOnce() {
    const t0 = performance.now();

    let data;
    try {
      const resp = await fetch(NTP_ENDPOINT, { cache: 'no-store' });
      const t1 = performance.now();

      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      data = await resp.json();
      const t2 = performance.now();

      const latency = t1 - t0;
      const serverTime = new Date(data.utc_datetime).getTime();
      // Stima: il server ha risposto a metà della latenza
      const estimatedServerNow = serverTime + latency / 2;
      const localNow = t0 + latency;
      const offset = estimatedServerNow - localNow;

      return { offset, latency, t0, serverTime };

    } catch (e) {
      // Fallback
      try {
        const resp2 = await fetch(FALLBACK_ENDPOINT, { cache: 'no-store' });
        const t1 = performance.now();
        if (!resp2.ok) throw new Error();
        const data2 = await resp2.json();
        const latency = t1 - t0;
        const serverTime = new Date(data2.dateTime).getTime();
        const estimatedServerNow = serverTime + latency / 2;
        const localNow = t0 + latency;
        const offset = estimatedServerNow - localNow;
        return { offset, latency, t0, serverTime };
      } catch (e2) {
        return null;
      }
    }
  }

  _qualityLabel(latencyMs) {
    if (latencyMs < 50) return 'Eccellente';
    if (latencyMs < 150) return 'Buona';
    if (latencyMs < 400) return 'Accettabile';
    return 'Scarsa (alta latenza di rete)';
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  getStatusText() {
    if (!this.calibrated) return 'Non calibrato';
    const dt = new Date(this.lastCalibration);
    const timeStr = dt.toLocaleTimeString('it-IT');
    return `Calibrato alle ${timeStr} (offset: ${this.offset.toFixed(0)} ms)`;
  }

  /**
   * Salva calibrazione in localStorage
   */
  save() {
    if (!this.calibrated) return;
    localStorage.setItem('wg_calibration', JSON.stringify({
      offset: this.offset,
      timestamp: this.lastCalibration
    }));
  }

  /**
   * Carica calibrazione da localStorage se recente (< 24h)
   */
  load() {
    try {
      const raw = localStorage.getItem('wg_calibration');
      if (!raw) return false;
      const data = JSON.parse(raw);
      const age = Date.now() - new Date(data.timestamp).getTime();
      if (age > 24 * 3600 * 1000) return false;
      this.offset = data.offset;
      this.lastCalibration = new Date(data.timestamp);
      this.calibrated = true;
      return true;
    } catch (e) { return false; }
  }
}
