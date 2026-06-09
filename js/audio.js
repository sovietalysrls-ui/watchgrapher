/**
 * audio.js — Gestione microfono e Web Audio API
 * Modulo responsabile di: enumerare dispositivi, aprire stream,
 * fornire campioni audio grezzi all'analyzer.
 */

export class AudioManager {
  constructor() {
    this.context = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.deviceId = null;
    this.onSamples = null; // callback(Float32Array, sampleRate)
    this.sampleRate = 44100;
    this.BUFFER_SIZE = 2048;
  }

  async listDevices() {
    // Richiede permesso microfono per ottenere le label
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch (e) { /* permesso negato */ }

    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter(d => d.kind === 'audioinput')
      .map(d => ({ id: d.deviceId, label: d.label || `Microfono ${d.deviceId.slice(0,6)}` }));
  }

  async start(deviceId, onSamples) {
    this.deviceId = deviceId;
    this.onSamples = onSamples;

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        sampleRate: { ideal: 44100 },
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.context = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 44100
    });
    this.sampleRate = this.context.sampleRate;
    this.source = this.context.createMediaStreamSource(this.stream);

    // ScriptProcessor deprecato ma universale su PWA/mobile
    this.processor = this.context.createScriptProcessor(this.BUFFER_SIZE, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      if (this.onSamples) this.onSamples(new Float32Array(data), this.sampleRate);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  stop() {
    if (this.processor) { this.processor.disconnect(); this.processor = null; }
    if (this.source) { this.source.disconnect(); this.source = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.context) { this.context.close(); this.context = null; }
  }

  isRunning() {
    return this.stream !== null;
  }
}
