import './style.css';
import { audio } from './audio.js';
import { events } from './events.js';
import { FaviconCycler } from './favicon.js';
import { SpaceStationScene } from './scene.js';

const STREAM_STATUS_URL = 'https://mixnet.dev/status-json.xsl';
const STREAM_URL = 'https://mixnet.dev/stream';
const FALLBACK_AUDIO_URL = '/audio.ogg';
const VOLUME_STORAGE_KEY = 'freeside-dub:volume';
const DEFAULT_VOLUME = 0.8;

let scene;
let lastTime = performance.now();
let hasStarted = false;

function loadStoredVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(1, parsed));
  } catch (error) {
    console.error('Failed to read stored volume', error);
    return DEFAULT_VOLUME;
  }
}

function persistVolume(volume) {
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  } catch (error) {
    console.error('Failed to persist volume', error);
  }
}

function setupVolumeControl() {
  const root = document.getElementById('volume-control');
  const slider = document.getElementById('volume-slider');
  const valueLabel = document.getElementById('volume-value');

  const initialVolume = loadStoredVolume();
  audio.setVolume(initialVolume);

  const initialPercent = Math.round(initialVolume * 100);
  slider.value = String(initialPercent);
  valueLabel.textContent = String(initialPercent);

  slider.addEventListener('input', () => {
    const percent = Number.parseInt(slider.value, 10);
    const volume = Number.isFinite(percent) ? percent / 100 : DEFAULT_VOLUME;
    audio.setVolume(volume);
    valueLabel.textContent = String(percent);
    persistVolume(volume);
  });

  return root;
}

function revealVolumeControl(root) {
  root.classList.remove('hidden');
  root.setAttribute('aria-hidden', 'false');
  scene.setVolumeControl(root);
}

function setLabel(label, title, text) {
  label.innerHTML = `<strong>${title}</strong> ${text}`;
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
      isOfflineFallback: true,
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
  container.classList.remove('metadata-grid--offline');
  container.replaceChildren(...entries.map(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'metadata-card';

    const title = document.createElement('strong');
    title.textContent = label;

    const text = document.createElement('span');
    text.textContent = value;

    card.append(title, text);
    return card;
  }));
}

function renderOfflineMetadata(container) {
  container.classList.add('metadata-grid--offline');

  const indicator = document.createElement('div');
  indicator.className = 'offline-indicator';

  const text = document.createElement('span');
  text.className = 'offline-indicator__text';
  text.dataset.text = text.textContent = 'OFFLINE';

  indicator.append(text);
  container.replaceChildren(indicator);
}

function sanitizeTerminalValue(value, maxLength = 54) {
  const normalized = String(value ?? 'unknown')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?')
    .trim();

  if (!normalized) {
    return 'UNKNOWN';
  }

  return normalized.slice(0, maxLength).toUpperCase();
}

function detectBrowserName(userAgent, brands) {
  const brandLabel = brands.join(' ');

  if (brandLabel.includes('Brave') || navigator.brave) return 'BRAVE';
  if (/Edg\//.test(userAgent) || brandLabel.includes('Microsoft Edge')) return 'EDGE';
  if (/OPR\//.test(userAgent) || brandLabel.includes('Opera')) return 'OPERA';
  if (/Firefox\//.test(userAgent) || brandLabel.includes('Firefox')) return 'FIREFOX';
  if (/Chrome\//.test(userAgent) || brandLabel.includes('Chromium') || brandLabel.includes('Google Chrome')) return 'CHROME';
  if (/Safari\//.test(userAgent)) return 'SAFARI';

  return 'UNKNOWN BROWSER';
}

function detectOperatingSystem(userAgent, platformHint) {
  const platform = `${platformHint || ''} ${userAgent}`;

  if (/Windows/i.test(platform)) return 'WINDOWS';
  if (/Android/i.test(platform)) return 'ANDROID';
  if (/(iPhone|iPad|iPod)/i.test(platform)) return 'IOS';
  if (/Mac/i.test(platform)) return 'MACOS';
  if (/Linux/i.test(platform)) return 'LINUX';

  return 'UNKNOWN OS';
}

function detectEngineName(userAgent) {
  if (/Firefox\//.test(userAgent)) return 'GECKO';
  if (/AppleWebKit\//.test(userAgent) && /Chrome\//.test(userAgent)) return 'BLINK';
  if (/AppleWebKit\//.test(userAgent)) return 'WEBKIT';

  return 'UNKNOWN ENGINE';
}

function collectExtensionSignals() {
  const hits = [];
  const root = document.documentElement;
  const ethereumProviders = Array.isArray(window.ethereum?.providers)
    ? window.ethereum.providers
    : window.ethereum
      ? [window.ethereum]
      : [];

  if (ethereumProviders.some((provider) => provider?.isMetaMask)) hits.push('METAMASK');
  if (ethereumProviders.some((provider) => provider?.isCoinbaseWallet)) hits.push('COINBASE');
  if ('__REACT_DEVTOOLS_GLOBAL_HOOK__' in window) hits.push('REACT DEVTOOLS');
  if ('__VUE_DEVTOOLS_GLOBAL_HOOK__' in window) hits.push('VUE DEVTOOLS');
  if (document.querySelector('style[data-darkreader-mode], #dark-reader-style, meta[name="darkreader-lock"]')) hits.push('DARK READER');
  if (document.querySelector('[data-new-gr-c-s-check-loaded], grammarly-extension, grammarly-desktop-integration')) hits.push('GRAMMARLY');
  if (root.hasAttribute('data-lt-installed')) hits.push('LANGUAGETOOL');

  return [...new Set(hits)];
}

function buildRuntimeProfile() {
  const userAgent = navigator.userAgent || 'unknown';
  const brands = Array.isArray(navigator.userAgentData?.brands)
    ? navigator.userAgentData.brands.map(({ brand, version }) => `${brand} ${version}`)
    : [];
  const browser = detectBrowserName(userAgent, brands);
  const operatingSystem = detectOperatingSystem(userAgent, navigator.userAgentData?.platform || navigator.platform);
  const engine = detectEngineName(userAgent);
  const languages = (Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language]
  ).filter(Boolean);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  const extensionSignals = collectExtensionSignals();
  const extensionSummary = extensionSignals.length ? extensionSignals.join(', ') : 'NO EASY HOOKS';
  const screenSummary = window.screen
    ? `${window.screen.width}x${window.screen.height} / ${window.screen.colorDepth}BPP`
    : 'SCREEN UNKNOWN';
  const resourceSummary = [
    navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} THREADS` : 'THREADS ?',
    navigator.deviceMemory ? `${navigator.deviceMemory}GB HINT` : 'MEM ?',
  ].join(' / ');
  const inputSummary = navigator.maxTouchPoints ? `${navigator.maxTouchPoints} TOUCH POINTS` : 'MOUSE BIAS';
  const dntValue = navigator.doNotTrack === '1'
    ? 'ON'
    : navigator.doNotTrack === '0'
      ? 'OFF'
      : 'UNSET';
  const brandSummary = brands.length ? brands.join(' | ') : 'UA-CH WITHHELD';
  const bootLineSpecs = [
    ['Probe   client shell ......... ', `${browser} / ${operatingSystem}`, 28],
    ['Probe   render engine ........ ', engine, 28],
    ['Probe   ua brands ............ ', brandSummary, 42],
    ['Probe   locale / zone ........ ', `${languages.slice(0, 3).join(', ')} / ${timezone}`, 42],
    ['Probe   screen lattice ....... ', screenSummary, 42],
    ['Probe   cores / mem .......... ', resourceSummary, 42],
    ['Probe   input residue ........ ', inputSummary, 42],
    ['Probe   do-not-track ......... ', dntValue, 42],
    ['Probe   ext residue .......... ', extensionSummary, 42],
  ];

  return {
    browser,
    operatingSystem,
    engine,
    extensionSummary,
    bootLines: bootLineSpecs.map(([prefix, value, maxLength]) => `${prefix}${sanitizeTerminalValue(value, maxLength)}`),
  };
}

function buildTerminalTelemetry(audioSource, runtimeProfile) {
  const metadata = audioSource.metadata;

  return {
    title: audioSource.label,
    status: audioSource.status,
    lines: [
      `SOURCE // ${metadata.title}`,
      `MODE   // ${audioSource.type === 'stream' ? 'LIVE RELAY' : 'LOCAL ARCHIVE'}`,
      `CLIENT // ${runtimeProfile.browser} / ${runtimeProfile.operatingSystem}`,
      `ENGINE // ${runtimeProfile.engine}`,
      `EXTSIG // ${runtimeProfile.extensionSummary}`,
      `GENRE  // ${metadata.genre}`,
      `FORMAT // ${metadata.format}`,
      `PEERS  // ${metadata.listeners ? `At least ${metadata.listeners}` : 'N/A'}`,
    ],
    bootLines: runtimeProfile.bootLines,
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

  const volumeControl = setupVolumeControl();

  const runtimeProfile = buildRuntimeProfile();
  scene = new SpaceStationScene(canvasContainer, { bootTerminalOs: runtimeProfile.operatingSystem });
  setLabel(modeLabel, 'Mode', 'Deep space telemetry');
  setLabel(statusLabel, 'Status', 'Polling uplink');

  const audioSource = await resolveAudioSourceConfig();
  subhead.textContent = audioSource.summaryLabel;
  bodyCopy.textContent = audioSource.detailText;
  hint.textContent = audioSource.hintText;
  if (audioSource.isOfflineFallback) {
    renderOfflineMetadata(metadataContainer);
  } else {
    renderMetadata(metadataContainer, buildMetadataEntries(audioSource));
  }
  setLabel(modeLabel, 'Mode', audioSource.modeLabel);
  scene.setTelemetry(buildTerminalTelemetry(audioSource, runtimeProfile));

  audio.load(audioSource).then(() => {
    startBtn.innerText = audioSource.buttonLabel;
    setLabel(statusLabel, 'Status', audioSource.readyLabel);
    startBtn.disabled = false;
  }).catch((error) => {
    console.error('Failed to load audio source', error);
    startBtn.innerText = 'LINK ERROR';
    setLabel(statusLabel, 'Status', audioSource.failureLabel);
  });

  startBtn.addEventListener('click', async () => {
    if (!audio.isLoaded || hasStarted) return;

    startBtn.disabled = true;

    try {
      await audio.play();
      hasStarted = true;
      lastTime = performance.now();
      uiOverlay.classList.add('hidden');
      revealVolumeControl(volumeControl);
      scene.setTelemetryVisible(true);
      scene.enableBootTerminalHotkeys();
      setTimeout(() => scene.playStartupTerminal(), 1000);

      events.state.distortion = 1.4;
      events.state.fringe = 0.8;
      events.state.pulse = 0.6;

      animate();
    } catch (error) {
      console.error('Failed to start audio playback', error);
      startBtn.disabled = false;
      startBtn.innerText = 'RETRY LINK';
      setLabel(statusLabel, 'Status', 'PLAYBACK AUTHORIZATION FAILED');
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
