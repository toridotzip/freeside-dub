import { events } from './events.js';

//robinAudioEngine v3 @coderobe

const BAND_CONFIGS = [
  { name: 'bass', minFreq: 20, maxFreq: 110, triggerThreshold: 0.72, minLevel: 0.24, cooldownMax: 0.18, initialPeak: 0.6, hitState: 'bass_hit' },
  { name: 'lowmid', minFreq: 110, maxFreq: 320, triggerThreshold: 0.68, minLevel: 0.22, cooldownMax: 0.14, initialPeak: 0.55, hitState: 'lowmid_hit' },
  { name: 'mid', minFreq: 320, maxFreq: 1600, triggerThreshold: 0.64, minLevel: 0.2, cooldownMax: 0.12, initialPeak: 0.5, hitState: 'mid_hit' },
  { name: 'highmid', minFreq: 1600, maxFreq: 4500, triggerThreshold: 0.6, minLevel: 0.18, cooldownMax: 0.09, initialPeak: 0.45, hitState: 'vocal_hit' },
  { name: 'high', minFreq: 4500, maxFreq: 14000, triggerThreshold: 0.56, minLevel: 0.16, cooldownMax: 0.07, initialPeak: 0.4, hitState: 'high_hit' },
];

export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.18;

    this.output = this.ctx.createGain();
    this.output.gain.value = 1.0;
    this.analyser.connect(this.output);
    this.output.connect(this.ctx.destination);

    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
    this.previousDataArray = new Uint8Array(this.bufferLength);
    this.timeDataArray = new Uint8Array(this.analyser.fftSize);

    this.audioBuffer = null;
    this.bufferSource = null;
    this.mediaElement = null;
    this.mediaElementSource = null;
    this.currentSource = null;
    this.currentSourceType = 'buffer';
    this.isLoaded = false;
    this.isPlaying = false;
    this.historySize = 72;

    this.bands = BAND_CONFIGS.map(({ name, minFreq, maxFreq, triggerThreshold, minLevel, cooldownMax, initialPeak, hitState }) => ({
      name,
      minFreq,
      maxFreq,
      triggerThreshold,
      minLevel,
      hitState,
      cooldownTimer: 0,
      cooldownMax,
      fluxHistory: new Float32Array(this.historySize),
      fluxHistoryIndex: 0,
      fluxHistoryCount: 0,
      fluxSum: 0,
      fluxSumSquares: 0,
      envelope: 0,
      floor: 0,
      peak: initialPeak,
      initialPeak,
      transient: 0,
      range: 1,
    }));

    const sampleRate = this.ctx.sampleRate || 44100;
    this.bands.forEach((band) => {
      band.minIdx = Math.max(0, Math.floor((band.minFreq / (sampleRate / 2)) * this.bufferLength));
      band.maxIdx = Math.min(this.bufferLength - 1, Math.ceil((band.maxFreq / (sampleRate / 2)) * this.bufferLength));
      band.range = Math.max(1, band.maxIdx - band.minIdx);
    });

    this.lastTime = performance.now();
  }

  normalizeSourceConfig(source) {
    if (typeof source === 'string') {
      return { type: 'buffer', url: source };
    }

    if (!source || typeof source.url !== 'string' || source.url.length === 0) {
      throw new Error('Audio source must provide a non-empty url.');
    }

    if (source.type !== 'buffer' && source.type !== 'stream') {
      throw new Error(`Unsupported audio source type: ${source.type}`);
    }

    const { type, url, metadata = null, label = null, status = null } = source;
    return { type, url, metadata, label, status };
  }

  resetAnalysisState() {
    this.dataArray.fill(0);
    this.previousDataArray.fill(0);
    this.timeDataArray.fill(128);
    const { state } = events;

    this.bands.forEach((band) => {
      band.cooldownTimer = 0;
      band.fluxHistoryIndex = 0;
      band.fluxHistoryCount = 0;
      band.fluxSum = 0;
      band.fluxSumSquares = 0;
      band.envelope = 0;
      band.floor = 0;
      band.peak = band.initialPeak;
      band.transient = 0;
      state.bands[band.name] = 0;
    });

    state.energy = 0;
    state.rms = 0;
    state.centroid = 0;
  }

  disconnectBufferSource() {
    if (!this.bufferSource) return;

    this.bufferSource.onended = null;
    this.bufferSource.stop();
    this.bufferSource.disconnect();
    this.bufferSource = null;
  }

  disconnectMediaElement() {
    if (!this.mediaElement) return;

    this.mediaElement.pause();

    if (this.mediaElementSource) {
      this.mediaElementSource.disconnect();
      this.mediaElementSource = null;
    }

    this.mediaElement.removeAttribute('src');
    this.mediaElement.load();
    this.mediaElement = null;
  }

  clearCurrentSource() {
    if (this.currentSourceType === 'buffer') {
      this.disconnectBufferSource();
    } else {
      this.disconnectMediaElement();
    }

    this.audioBuffer = null;
    this.currentSource = null;
    this.isLoaded = false;
    this.isPlaying = false;
  }

  async loadBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio buffer: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
  }

  async loadStream(url) {
    const mediaElement = new Audio();
    mediaElement.crossOrigin = 'anonymous';
    mediaElement.preload = 'auto';
    mediaElement.playsInline = true;
    mediaElement.src = url;

    try {
      await new Promise((resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          const error = mediaElement.error;
          reject(new Error(`Failed to load live stream${error ? ` (code ${error.code})` : ''}.`));
        };
        const cleanup = () => {
          mediaElement.removeEventListener('canplay', onReady);
          mediaElement.removeEventListener('error', onError);
        };

        mediaElement.addEventListener('canplay', onReady);
        mediaElement.addEventListener('error', onError);
        mediaElement.load();
      });
    } catch (error) {
      mediaElement.removeAttribute('src');
      mediaElement.load();
      throw error;
    }

    this.mediaElement = mediaElement;
    this.mediaElementSource = this.ctx.createMediaElementSource(mediaElement);
    this.mediaElementSource.connect(this.analyser);
  }

  async load(source) {
    const config = this.normalizeSourceConfig(source);
    this.clearCurrentSource();
    this.currentSource = config;
    this.currentSourceType = config.type;
    this.resetAnalysisState();

    if (config.type === 'stream') {
      await this.loadStream(config.url);
    } else {
      await this.loadBuffer(config.url);
    }

    this.isLoaded = true;
    events.emit('audio_loaded', config);
  }

  async play() {
    if (!this.isLoaded || !this.currentSource) return;

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.resetAnalysisState();

    if (this.currentSourceType === 'stream') {
      await this.playStream();
    } else {
      this.playBuffer();
    }

    this.isPlaying = true;
    this.lastTime = performance.now();
    events.emit('audio_started', this.currentSource);
  }

  playBuffer() {
    if (!this.audioBuffer) {
      throw new Error('No decoded audio buffer is available for playback.');
    }

    this.disconnectBufferSource();

    this.bufferSource = this.ctx.createBufferSource();
    this.bufferSource.buffer = this.audioBuffer;
    this.bufferSource.loop = true;
    this.bufferSource.connect(this.analyser);
    this.bufferSource.start(0);
  }

  async playStream() {
    if (!this.mediaElement) {
      throw new Error('No live stream element is available for playback.');
    }

    const playPromise = this.mediaElement.play();
    if (playPromise) {
      await playPromise;
    }
  }

  setVolume(volume) {
    const clamped = Math.max(0, Math.min(1, volume));
    this.output.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.015);
  }

  getVolume() {
    return this.output.gain.value;
  }

  recordFluxSample(band, flux) {
    const index = band.fluxHistoryIndex;
    const oldValue = band.fluxHistoryCount === this.historySize ? band.fluxHistory[index] : 0;

    band.fluxHistory[index] = flux;
    band.fluxHistoryIndex = (index + 1) % this.historySize;
    if (band.fluxHistoryCount < this.historySize) {
      band.fluxHistoryCount += 1;
    }

    band.fluxSum += flux - oldValue;
    band.fluxSumSquares += flux * flux - oldValue * oldValue;
  }

  getRms() {
    let sum = 0;

    for (let i = 0; i < this.timeDataArray.length; i++) {
      const centered = (this.timeDataArray[i] - 128) / 128;
      sum += centered * centered;
    }

    return Math.sqrt(sum / this.timeDataArray.length);
  }

  getSpectralCentroid() {
    let weightedSum = 0;
    let magnitudeSum = 0;

    for (let i = 0; i < this.dataArray.length; i++) {
      const magnitude = this.dataArray[i] / 255;
      weightedSum += i * magnitude;
      magnitudeSum += magnitude;
    }

    if (magnitudeSum === 0) return 0;
    return weightedSum / magnitudeSum / this.dataArray.length;
  }

  updateBandEnvelope(band, energy, dt) {
    const floorRate = energy < band.floor ? 7.5 : 0.6;
    const peakRate = energy > band.peak ? 7.0 : 0.28;

    band.floor += (energy - band.floor) * Math.min(1, dt * floorRate);
    band.peak += (energy - band.peak) * Math.min(1, dt * peakRate);
    if (band.peak < band.floor + 0.05) {
      band.peak = band.floor + 0.05;
    }

    const normalized = Math.min(1.2, Math.max(0, (energy - band.floor) / (band.peak - band.floor + 0.0001)));
    const envelopeRate = normalized > band.envelope ? 10.0 : 3.0;
    band.envelope += (normalized - band.envelope) * Math.min(1, dt * envelopeRate);
    return normalized;
  }

  update() {
    if (!this.isPlaying) return;

    const state = events.state;
    const stateBands = state.bands;

    this.previousDataArray.set(this.dataArray);
    this.analyser.getByteFrequencyData(this.dataArray);
    this.analyser.getByteTimeDomainData(this.timeDataArray);

    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const rms = this.getRms();
    const centroid = this.getSpectralCentroid();
    const transientDecay = Math.pow(0.5, dt * 10);

    let totalEnvelope = 0;

    for (const band of this.bands) {
      let energySum = 0;
      let fluxSum = 0;

      for (let i = band.minIdx; i < band.maxIdx; i++) {
        const value = this.dataArray[i];
        energySum += value;
        const diff = value - this.previousDataArray[i];
        if (diff > 0) fluxSum += diff;
      }

      const energy = energySum / band.range / 255;
      const flux = fluxSum / band.range / 255;
      this.recordFluxSample(band, flux);
      const normalized = this.updateBandEnvelope(band, energy, dt);
      const avgFlux = band.fluxHistoryCount ? band.fluxSum / band.fluxHistoryCount : 0;
      const fluxVariance = band.fluxHistoryCount
        ? Math.max(0, band.fluxSumSquares / band.fluxHistoryCount - avgFlux * avgFlux)
        : 0;
      const transientThreshold = avgFlux + Math.sqrt(fluxVariance) * 0.8 + 0.01;
      const transient = Math.max(0, (flux - transientThreshold) * 5.0);

      band.transient *= transientDecay;
      band.transient = Math.max(band.transient, transient);
      band.cooldownTimer -= dt;

      const confidence = Math.min(1.2, normalized * 0.6 + band.transient * 0.4);
      stateBands[band.name] = band.envelope;

      if (confidence > band.triggerThreshold && normalized > band.minLevel && band.cooldownTimer <= 0) {
        events.emit(`beat_${band.name}`, { confidence, energy, flux, normalized, transient: band.transient });

        if (band.hitState) {
          state[band.hitState] = 1.0;
        }

        band.cooldownTimer = band.cooldownMax;
      }

      totalEnvelope += band.envelope;
    }

    const [bass, lowmid, mid, highmid, high] = this.bands;

    const lowDrive = bass.envelope * 0.72 + lowmid.envelope * 0.28;
    const midDrive = lowmid.envelope * 0.2 + mid.envelope * 0.55 + highmid.envelope * 0.25;
    const highDrive = highmid.envelope * 0.42 + high.envelope * 0.58;

    state.rms = rms;
    state.centroid = centroid;
    state.energy = totalEnvelope / this.bands.length;
    state.pulse = Math.max(state.pulse, lowDrive * 0.32 + bass.transient * 0.75 + rms * 0.2);
    state.sweep = Math.max(state.sweep, midDrive * 0.42 + highmid.transient * 0.45 + centroid * 0.22);
    state.shimmer = Math.max(state.shimmer, highDrive * 0.34 + high.transient * 0.62);
    state.distortion = Math.max(state.distortion, bass.transient * 0.45 + mid.transient * 0.18);
    state.fringe = Math.max(state.fringe, high.transient * 0.32 + highDrive * 0.14);

    const speedTarget = 0.86 + state.energy * 0.24 + lowmid.envelope * 0.1 + rms * 0.08;
    state.globalSpeed += (speedTarget - state.globalSpeed) * Math.min(1, dt * 2.8);
  }
}

export const audio = new AudioEngine();
