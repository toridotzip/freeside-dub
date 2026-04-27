import { events } from './events.js';

//robinAudioEngine v3 @coderobe

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

    this.bands = [
      { name: 'bass', minFreq: 20, maxFreq: 110, triggerThreshold: 0.72, minLevel: 0.24, cooldownTimer: 0, cooldownMax: 0.18, energyHistory: [], fluxHistory: [], envelope: 0, floor: 0, peak: 0.6, initialPeak: 0.6, transient: 0 },
      { name: 'lowmid', minFreq: 110, maxFreq: 320, triggerThreshold: 0.68, minLevel: 0.22, cooldownTimer: 0, cooldownMax: 0.14, energyHistory: [], fluxHistory: [], envelope: 0, floor: 0, peak: 0.55, initialPeak: 0.55, transient: 0 },
      { name: 'mid', minFreq: 320, maxFreq: 1600, triggerThreshold: 0.64, minLevel: 0.2, cooldownTimer: 0, cooldownMax: 0.12, energyHistory: [], fluxHistory: [], envelope: 0, floor: 0, peak: 0.5, initialPeak: 0.5, transient: 0 },
      { name: 'highmid', minFreq: 1600, maxFreq: 4500, triggerThreshold: 0.6, minLevel: 0.18, cooldownTimer: 0, cooldownMax: 0.09, energyHistory: [], fluxHistory: [], envelope: 0, floor: 0, peak: 0.45, initialPeak: 0.45, transient: 0 },
      { name: 'high', minFreq: 4500, maxFreq: 14000, triggerThreshold: 0.56, minLevel: 0.16, cooldownTimer: 0, cooldownMax: 0.07, energyHistory: [], fluxHistory: [], envelope: 0, floor: 0, peak: 0.4, initialPeak: 0.4, transient: 0 },
    ];

    const sampleRate = this.ctx.sampleRate || 44100;
    this.bands.forEach((band) => {
      band.minIdx = Math.max(0, Math.floor((band.minFreq / (sampleRate / 2)) * this.bufferLength));
      band.maxIdx = Math.min(this.bufferLength - 1, Math.ceil((band.maxFreq / (sampleRate / 2)) * this.bufferLength));
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

    return {
      type: source.type,
      url: source.url,
      metadata: source.metadata ?? null,
      label: source.label ?? null,
      status: source.status ?? null,
    };
  }

  resetAnalysisState() {
    this.dataArray.fill(0);
    this.previousDataArray.fill(0);
    this.timeDataArray.fill(128);

    this.bands.forEach((band) => {
      band.cooldownTimer = 0;
      band.energyHistory.length = 0;
      band.fluxHistory.length = 0;
      band.envelope = 0;
      band.floor = 0;
      band.peak = band.initialPeak;
      band.transient = 0;
    });

    events.state.energy = 0;
    events.state.rms = 0;
    events.state.centroid = 0;
    events.state.bands.bass = 0;
    events.state.bands.lowmid = 0;
    events.state.bands.mid = 0;
    events.state.bands.highmid = 0;
    events.state.bands.high = 0;
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

  pushHistory(history, value) {
    history.push(value);
    if (history.length > this.historySize) {
      history.shift();
    }
  }

  getHistoryStats(history) {
    let sum = 0;
    for (let i = 0; i < history.length; i++) {
      sum += history[i];
    }

    const avg = history.length > 0 ? sum / history.length : 0;
    let varianceSum = 0;
    for (let i = 0; i < history.length; i++) {
      varianceSum += Math.pow(history[i] - avg, 2);
    }

    const variance = history.length > 0 ? varianceSum / history.length : 0;
    return { avg, variance };
  }

  getFluxInBand(minIdx, maxIdx) {
    let flux = 0;

    for (let i = minIdx; i < maxIdx; i++) {
      const diff = this.dataArray[i] - this.previousDataArray[i];
      if (diff > 0) flux += diff;
    }

    const range = Math.max(1, maxIdx - minIdx);
    return flux / range;
  }

  getEnergyInBand(minIdx, maxIdx) {
    let sum = 0;

    for (let i = minIdx; i < maxIdx; i++) {
      sum += this.dataArray[i];
    }

    const range = Math.max(1, maxIdx - minIdx);
    return sum / range;
  }

  getRms() {
    let sum = 0;

    for (let i = 0; i < this.timeDataArray.length; i++) {
      const sample = (this.timeDataArray[i] - 128) / 128;
      sum += sample * sample;
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

    this.previousDataArray.set(this.dataArray);
    this.analyser.getByteFrequencyData(this.dataArray);
    this.analyser.getByteTimeDomainData(this.timeDataArray);

    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const rms = this.getRms();
    const centroid = this.getSpectralCentroid();

    let totalEnvelope = 0;

    this.bands.forEach((band) => {
      const energy = this.getEnergyInBand(band.minIdx, band.maxIdx) / 255.0;
      const flux = this.getFluxInBand(band.minIdx, band.maxIdx) / 255.0;

      this.pushHistory(band.energyHistory, energy);
      this.pushHistory(band.fluxHistory, flux);

      const normalized = this.updateBandEnvelope(band, energy, dt);
      const { avg: avgFlux, variance: fluxVariance } = this.getHistoryStats(band.fluxHistory);
      const transientThreshold = avgFlux + Math.sqrt(fluxVariance) * 0.8 + 0.01;
      const transient = Math.max(0, (flux - transientThreshold) * 5.0);

      band.transient *= Math.pow(0.5, dt * 10.0);
      band.transient = Math.max(band.transient, transient);
      band.cooldownTimer -= dt;

      const confidence = Math.min(1.2, normalized * 0.6 + band.transient * 0.4);
      events.state.bands[band.name] = band.envelope;

      if (confidence > band.triggerThreshold && normalized > band.minLevel && band.cooldownTimer <= 0) {
        events.emit(`beat_${band.name}`, { confidence, energy, flux, normalized, transient: band.transient });

        if (band.name === 'bass') {
          events.state.bass_hit = 1.0;
        } else if (band.name === 'lowmid') {
          events.state.lowmid_hit = 1.0;
        } else if (band.name === 'mid') {
          events.state.mid_hit = 1.0;
        } else if (band.name === 'highmid') {
          events.state.vocal_hit = 1.0;
        } else if (band.name === 'high') {
          events.state.high_hit = 1.0;
        }

        band.cooldownTimer = band.cooldownMax;
      }

      totalEnvelope += band.envelope;
    });

    const bass = this.bands[0];
    const lowmid = this.bands[1];
    const mid = this.bands[2];
    const highmid = this.bands[3];
    const high = this.bands[4];

    const lowDrive = bass.envelope * 0.72 + lowmid.envelope * 0.28;
    const midDrive = lowmid.envelope * 0.2 + mid.envelope * 0.55 + highmid.envelope * 0.25;
    const highDrive = highmid.envelope * 0.42 + high.envelope * 0.58;

    events.state.rms = rms;
    events.state.centroid = centroid;
    events.state.energy = totalEnvelope / this.bands.length;
    events.state.pulse = Math.max(events.state.pulse, lowDrive * 0.32 + bass.transient * 0.75 + rms * 0.2);
    events.state.sweep = Math.max(events.state.sweep, midDrive * 0.42 + highmid.transient * 0.45 + centroid * 0.22);
    events.state.shimmer = Math.max(events.state.shimmer, highDrive * 0.34 + high.transient * 0.62);
    events.state.distortion = Math.max(events.state.distortion, bass.transient * 0.45 + mid.transient * 0.18);
    events.state.fringe = Math.max(events.state.fringe, high.transient * 0.32 + highDrive * 0.14);

    const speedTarget = 0.86 + events.state.energy * 0.24 + lowmid.envelope * 0.1 + rms * 0.08;
    events.state.globalSpeed += (speedTarget - events.state.globalSpeed) * Math.min(1, dt * 2.8);
  }
}

export const audio = new AudioEngine();
