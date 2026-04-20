import './style.css';
import { audio } from './audio.js';
import { events } from './events.js';
import { FaviconCycler } from './favicon.js';
import { SpaceStationScene } from './scene.js';

const STREAM_STATUS_URL = 'https://mixnet.dev/status-json.xsl';
const STREAM_URL = 'https://mixnet.dev/stream';
const FALLBACK_AUDIO_URL = '/audio.ogg';

let scene;
let lastTime = performance.now();
let hasStarted = false;

function setStatus(statusLabel, text) {
  statusLabel.innerHTML = `<strong>Status</strong> ${text}`;
}

function setMode(modeLabel, text) {
  modeLabel.innerHTML = `<strong>Mode</strong> ${text}`;
}

function parseStatusPayload(payload) {
  const sourceEntry = Array.isArray(payload?.icestats?.source)
    ? payload.icestats.source.find((entry) => entry?.listenurl) ?? payload.icestats.source[0]
    : payload?.icestats?.source;

  if (!sourceEntry || typeof sourceEntry !== 'object') {
    return null;
  }

  return {
    title: sourceEntry.server_name || payload.icestats.host || 'Mixnet relay',
    description: sourceEntry.server_description || 'Live Icecast relay',
    genre: sourceEntry.genre || 'Unknown genre',
    bitrate: sourceEntry.bitrate || sourceEntry['ice-bitrate'] || null,
    listeners: sourceEntry.listeners ?? null,
    format: [sourceEntry.server_type, sourceEntry.subtype].filter(Boolean).join(' / ') || 'Unknown format',
    sampleRate: sourceEntry.audio_samplerate || null,
    host: payload.icestats.host || 'mixnet.dev',
    location: payload.icestats.location || 'Unknown location',
    website: sourceEntry.server_url || null,
    startedAt: sourceEntry.stream_start || null,
  };
}

async function resolveAudioSourceConfig() {
  try {
    const response = await fetch(STREAM_STATUS_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Status probe failed with ${response.status}`);
    }

    const raw = await response.text();
    const payload = JSON.parse(raw);
    const metadata = parseStatusPayload(payload);
    if (!metadata) {
      throw new Error('Stream metadata was missing from the status payload.');
    }

    return {
      type: 'stream',
      url: STREAM_URL,
      label: 'Mixnet live stream',
      status: 'ONLINE',
      metadata,
      readyLabel: 'MIXNET LIVE UPLINK STABLE',
      failureLabel: 'LIVE UPLINK PLAYBACK FAILED',
      modeLabel: 'relay telemetry',
      buttonLabel: 'TUNE IN',
      summaryLabel: 'Mixnet uplink ready',
      detailText: metadata.description,
      hintText: 'Freeside Deep-Space Telemetry Live Downstream connected.',
    };
  } catch (error) {
    console.warn('Mixnet stream probe failed, using local audio fallback.', error);
    return {
      type: 'buffer',
      url: FALLBACK_AUDIO_URL,
      label: 'Local fallback archive',
      status: 'FALLBACK',
      metadata: {
        title: 'Offline fallback archive',
        description: 'Mixnet relay unavailable. Switching to the bundled audio file.',
        genre: 'Local signal cache',
        bitrate: null,
        listeners: null,
        format: 'Decoded audio buffer',
        sampleRate: null,
        host: 'Local asset store',
        location: 'Orbital cache module',
        website: null,
        startedAt: null,
      },
      readyLabel: 'ARCHIVE UPLINK STABLE',
      failureLabel: 'ARCHIVE PLAYBACK FAILED',
      modeLabel: 'Fallback archive telemetry',
      buttonLabel: 'PLAY ARCHIVE',
      summaryLabel: 'Mixnet uplink offline',
      detailText: 'The station will use the local track until the live relay is reachable again.',
      hintText: 'Mixnet probe failed, so the bundled audio file is armed for launch.',
    };
  }
}

function buildMetadataEntries(audioSource) {
  const metadata = audioSource.metadata;

  return [
    ['Source', metadata.title],
    ['Genre', metadata.genre],
    ['Bitrate', metadata.bitrate ? `${metadata.bitrate} kbps (${metadata.format})` : 'N/A'],
    ['Location', metadata.location],
  ];
}

function renderMetadata(container, entries) {
  container.replaceChildren();

  entries.forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'metadata-card';

    const title = document.createElement('strong');
    title.textContent = label;

    const text = document.createElement('span');
    text.textContent = value;

    card.append(title, text);
    container.append(card);
  });
}

function buildTerminalTelemetry(audioSource) {
  const metadata = audioSource.metadata;

  return {
    title: audioSource.label,
    status: audioSource.status,
    lines: [
      `SOURCE // ${metadata.title}`,
      `MODE   // ${audioSource.type === 'stream' ? 'LIVE RELAY' : 'LOCAL ARCHIVE'}`,
      `GENRE  // ${metadata.genre}`,
      `FORMAT // ${metadata.format}`,
      `RATE   // ${metadata.bitrate ? `${metadata.bitrate} KBPS` : 'N/A'}`,
      `PEERS  // ${metadata.listeners ? `At least ${metadata.listeners}` : 'N/A'}`,
    ],
  };
}

async function init() {
  const startBtn = document.getElementById('start-btn');
  const statusLabel = document.getElementById('status-label');
  const modeLabel = document.getElementById('mode-label');
  const uiOverlay = document.getElementById('ui');
  const canvasContainer = document.getElementById('canvas-container');
  const subhead = document.getElementById('source-subhead');
  const bodyCopy = document.getElementById('source-body');
  const metadataContainer = document.getElementById('source-metadata');
  const hint = document.getElementById('source-hint');
  startBtn.disabled = true;

  new FaviconCycler().start();

  scene = new SpaceStationScene(canvasContainer);
  setMode(modeLabel, 'Deep space telemetry');
  setStatus(statusLabel, 'Polling uplink');

  const audioSource = await resolveAudioSourceConfig();
  subhead.textContent = audioSource.summaryLabel;
  bodyCopy.textContent = audioSource.detailText;
  hint.textContent = audioSource.hintText;
  renderMetadata(metadataContainer, buildMetadataEntries(audioSource));
  setMode(modeLabel, audioSource.modeLabel);
  scene.setTelemetry(buildTerminalTelemetry(audioSource));

  audio.load(audioSource).then(() => {
    startBtn.innerText = audioSource.buttonLabel;
    setStatus(statusLabel, audioSource.readyLabel);
    startBtn.disabled = false;
  }).catch((error) => {
    console.error('Failed to load audio source', error);
    startBtn.innerText = 'LINK ERROR';
    setStatus(statusLabel, audioSource.failureLabel);
  });

  startBtn.addEventListener('click', async () => {
    if (!audio.isLoaded || hasStarted) return;

    startBtn.disabled = true;

    try {
      await audio.play();
      hasStarted = true;
      lastTime = performance.now();
      uiOverlay.classList.add('hidden');
      scene.setTelemetryVisible(true);

      events.state.distortion = 1.4;
      events.state.fringe = 0.8;
      events.state.pulse = 0.6;

      animate();
    } catch (error) {
      console.error('Failed to start audio playback', error);
      startBtn.disabled = false;
      startBtn.innerText = 'RETRY LINK';
      setStatus(statusLabel, 'PLAYBACK AUTHORIZATION FAILED');
    }
  });
}

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  audio.update();
  events.update(dt);

  if (scene) {
    scene.update();
  }
}

document.addEventListener('DOMContentLoaded', init);
