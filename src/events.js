const BAND_NAMES = ['bass', 'lowmid', 'mid', 'highmid', 'high'];
const LINEAR_DECAYS = [['bass_hit', 4.0], ['lowmid_hit', 4.5], ['mid_hit', 5.0], ['vocal_hit', 6.0], ['high_hit', 8.0], ['pulse', 1.8], ['shimmer', 2.5], ['sweep', 1.1]];
const EXPONENTIAL_DECAYS = [['distortion', 9], ['fringe', 8]];

export class EventSystem {
  constructor() {
    this.listeners = {};
    this.state = {
      bass_hit: 0,
      lowmid_hit: 0,
      mid_hit: 0,
      vocal_hit: 0,
      high_hit: 0,
      energy: 0,
      rms: 0,
      centroid: 0,
      pulse: 0,
      shimmer: 0,
      sweep: 0,
      distortion: 0,
      fringe: 0,
      globalSpeed: 1,
      bands: Object.fromEntries(BAND_NAMES.map((name) => [name, 0])),
    };
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (!this.listeners[event]) return;

    for (const cb of this.listeners[event]) {
      cb(data);
    }
  }

  update(dt) {
    for (const [key, rate] of LINEAR_DECAYS) {
      this.state[key] = Math.max(0, this.state[key] - dt * rate);
    }

    for (const [key, rate] of EXPONENTIAL_DECAYS) {
      this.state[key] *= Math.pow(0.5, dt * rate);
      if (this.state[key] < 0.001) this.state[key] = 0;
    }
  }
}

export const events = new EventSystem();
