import * as THREE from 'three';
import { audio } from '../audio.js';
import { events } from '../events.js';
import { getCommandCompletions, runTerminalCommand } from '../cmd/index.js';
import { TerminalWindow, normalizeTerminalOs } from '../terminal.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

const BOOT_TERMINAL_KEYMAP = {
  w: 'WINDOWS',
  m: 'MACOS',
  l: 'LINUX',
};

const FREECAM_MOVEMENT_KEYS = {
  w: 'forward',
  a: 'left',
  s: 'backward',
  d: 'right',
};

const FREECAM_MOUSE_SENSITIVITY = 0.0023;
const FREECAM_MAX_PITCH = Math.PI * 0.48;
const FREECAM_BASE_SPEED = 12;
const FREECAM_BOOST_MULTIPLIER = 1.9;

const BOOT_SEQUENCE_TEMPLATES = {
  WINDOWS: {
    intro: [
      'Microsoft Windows [Version 10.0.19045.4291]',
      '(c) Microsoft Corporation. All rights reserved.',
      { pause: 220 },
    ],
    beforeFingerprint: [
      'C:\\>cd Windows\\freeside',
      'C:\\Windows\\freeside>',
    ],
    fingerprintCommand: 'C:\\Windows\\freeside>fingerprint.exe /quiet /ua /hooks /ext',
    probeLine: 'Probe   browser shell ........ slightly cursed',
    probePause: 260,
    uplinkCommand: 'C:\\Windows\\freeside>uplink.exe /fast /shadowMount /spoof',
    connectedLine: ({ normalizedTitle }) => `Connected to ${normalizedTitle}`,
    mountLine: 'Mount   \\\\.\\relay\\upload ...... OK',
    dumpCommand: 'C:\\Windows\\freeside>dump.bat',
    dumpLines: [
      'scanning...',
      { pause: 320 },
      'envs ...................DONE',
      'mem dump ...............DONE',
      'browser session ........DONE',
      'system keyring .........DONE',
      'Access denied - C:\\Windows\\pagefile.sys',
      'Access denied - C:\\Windows\\swapfile.sys',
      'Access denied - C:\\Windows\\system32',
      'elevating to SYSTEM ....................nailed it.',
      'wallets ................DONE',
      'cookies ................DONE',
    ],
    compressionLine: 'zipping...',
    uploadTarget: '\\\\.\\relay\\upload',
    uploadProgress: [
      'uploading .............. 12 % ',
      'uploading .............. 29 % ',
      'uploading .............. 51 % ',
      'uploading .............. 92 % ',
    ],
    cleanupLine: 'cleaning up .............OK',
    exitLine: 'C:\\> exit',
    fingerprintSuffix: '\n',
  },
  MACOS: {
    intro: ({ loginStamp }) => [`Last login: ${loginStamp} on console`],
    beforeFingerprint: ['root@localhost ~ % cd /Volumes/Freeside'],
    fingerprintCommand: 'root@localhost Freeside % ./fingerprint --quiet --ua --hooks --ext',
    probeLine: 'probe.shell = Terminal.app / zsh',
    probePause: 240,
    uplinkCommand: 'root@localhost Freeside % ./uplink --fast --shadow-mount --spoof',
    connectedLine: ({ normalizedTitle }) => `connected -> ${normalizedTitle}`,
    mountLine: 'mount /Volumes/relay/upload ........ok',
    dumpCommand: 'root@localhost Freeside % ./dump.sh',
    dumpLines: [
      'scanning...',
      { pause: 320 },
      'launch agents .................done',
      'memory pages ..................done',
      'browser session ...............done',
      'keychain sweep ................done',
      '/System/Library: Operation not permitted',
      '/private/var/vm/sleepimage: Operation not permitted',
      '/private/var/vm/swapfile0: Operation not permitted',
      'sudo escalation ........................accepted.',
      'wallets .......................done',
      'cookies .......................done',
    ],
    compressionLine: 'compressing...',
    uploadTarget: '/Volumes/relay/upload',
    uploadProgress: [
      'uploading ..................... 14%',
      'uploading ..................... 33%',
      'uploading ..................... 57%',
      'uploading ..................... 95%\n',
    ],
    cleanupLine: 'cleanup ....................... ok',
    exitLine: 'root@localhost Freeside % exit',
    fingerprintSuffix: '\n',
  },
  LINUX: {
    intro: [],
    beforeFingerprint: ['root@localhost:~$ cd /opt/freeside/'],
    fingerprintCommand: 'root@localhost:/opt/freeside$ ./fingerprint --quiet --ua --hooks --ext',
    probeLine: 'probe.shell = bash',
    probePause: 240,
    uplinkCommand: 'root@localhost:/opt/freeside$ ./uplink --fast --shadow-mount --spoof',
    connectedLine: ({ normalizedTitle }) => `connected -> ${normalizedTitle}`,
    mountLine: 'mount /mnt/relay/upload ............ok',
    dumpCommand: 'root@localhost:/opt/freeside$ ./dump.sh',
    dumpLines: [
      'scanning...',
      { pause: 320 },
      'env snapshots ...................... done',
      'memory scrape ...................... done',
      'browser session .................... done',
      'credential store ................... done',
      '/etc/shadow: Permission denied',
      '/proc/kcore: Permission denied',
      '/root: Permission denied',
      'sudo escalation ........................ acquired.',
      'wallets ............................ done',
      'cookies ............................ done',
    ],
    compressionLine: 'compressing...',
    uploadTarget: '/mnt/relay/upload',
    uploadProgress: [
      'uploading .......................... 11%',
      'uploading .......................... 36%',
      'uploading .......................... 63%',
      'uploading .......................... 97%',
    ],
    cleanupLine: 'cleanup ............................ ok',
    exitLine: 'root@localhost:/opt/freeside$ exit',
    fingerprintSuffix: ' \n',
  },
};

function resolveBootTemplateValue(value, context) {
  return typeof value === 'function' ? value(context) : value;
}

function formatBootTimestamp(date) {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.toLocaleDateString('en-US', { day: '2-digit' });
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return `${weekday} ${month} ${day} ${time}`;
}

export function initializeTerminalRuntimeState(scene, options = {}) {
  scene.telemetry = {
    title: 'Signal telemetry',
    status: 'STANDBY',
    lines: [],
  };
  scene.pointerPosition = new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5);
  scene.pointerVelocity = new THREE.Vector2();
  scene.pointerActive = false;
  scene.defaultBootTerminalOs = normalizeTerminalOs(options.bootTerminalOs);
  scene.bootHotkeysEnabled = false;
  scene.terminals = [];
  scene.commandTerminal = null;
  scene.nextTerminalSerial = 0;
  scene.nextTerminalZIndex = 20;
  scene.freecam = {
    active: false,
    terminal: null,
    position: new THREE.Vector3(),
    lookDirection: new THREE.Vector3(0, 0, -1),
    strafeDirection: new THREE.Vector3(1, 0, 0),
    lookTarget: new THREE.Vector3(),
    yaw: Math.PI,
    pitch: 0,
    moveState: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      boost: false,
    },
  };
  scene.freecamMoveVector = new THREE.Vector3();
  scene.pointerState = {
    active: false,
    position: scene.pointerPosition,
    velocity: scene.pointerVelocity,
  };
}

const terminalRuntimeMethods = {
  createTelemetryHud() {
    this.telemetryRoot = document.createElement('div');
    this.telemetryRoot.className = 'runtime-terminal';

    this.telemetryHeader = document.createElement('div');
    this.telemetryHeader.className = 'runtime-terminal__header';

    this.telemetryTitle = document.createElement('span');
    this.telemetryStatus = document.createElement('span');
    this.telemetryStatus.className = 'runtime-terminal__status';
    this.telemetryHeader.append(this.telemetryTitle, this.telemetryStatus);

    this.telemetryBody = document.createElement('div');
    this.telemetryBody.className = 'runtime-terminal__body';

    this.telemetryRoot.append(this.telemetryHeader, this.telemetryBody);
    this.container.appendChild(this.telemetryRoot);
    this.renderTelemetryHud();
  },

  renderTelemetryHud() {
    this.telemetryTitle.textContent = this.telemetry.title;
    this.telemetryStatus.textContent = this.telemetry.status;
    this.telemetryBody.replaceChildren();

    this.telemetry.lines.forEach((line) => {
      const entry = document.createElement('div');
      entry.className = 'runtime-terminal__line';
      entry.textContent = line;
      this.telemetryBody.append(entry);
    });
  },

  setTelemetry(telemetry) {
    this.telemetry = {
      title: telemetry?.title || 'Signal telemetry',
      status: telemetry?.status || 'STANDBY',
      lines: Array.isArray(telemetry?.lines) ? telemetry.lines : [],
      bootLines: Array.isArray(telemetry?.bootLines) ? telemetry.bootLines : [],
    };
    this.renderTelemetryHud();
  },

  setTelemetryVisible(isVisible) {
    if (!this.telemetryRoot) return;
    this.telemetryRoot.classList.toggle('visible', isVisible);
  },

  setVolumeControl(element) {
    this.volumeControlRoot = element;
  },

  setBootTerminalOs(bootTerminalOs) {
    this.defaultBootTerminalOs = normalizeTerminalOs(bootTerminalOs);

    if (this.commandTerminal && !this.commandTerminal.destroyed) {
      this.commandTerminal.applyVariant(this.defaultBootTerminalOs);
    }
  },

  enableBootTerminalHotkeys() {
    this.bootHotkeysEnabled = true;
  },

  bringTerminalToFront(terminal) {
    if (!terminal || terminal.destroyed) return;
    terminal.setZIndex(this.nextTerminalZIndex);
    this.nextTerminalZIndex += 1;
  },

  unregisterTerminal(terminal) {
    this.terminals = this.terminals.filter((entry) => entry !== terminal);

    if (this.commandTerminal === terminal) {
      this.commandTerminal = null;
    }

    if (this.freecam.terminal === terminal) {
      this.disableFreecam({ skipTerminalExit: true, releasePointerLock: true });
    }
  },

  getTerminalSpawnOffset(kind = 'boot') {
    const serial = this.nextTerminalSerial;
    this.nextTerminalSerial += 1;

    if (kind === 'command') {
      return {
        x: Math.min(220, window.innerWidth * 0.18),
        y: Math.min(120, window.innerHeight * 0.12),
      };
    }

    const column = serial % 3;
    const row = Math.floor(serial / 3) % 3;

    return {
      x: (column - 1) * 58,
      y: (row - 1) * 46,
    };
  },

  createTerminal(options = {}) {
    const spawnOffset = Number.isFinite(options.baseOffsetX) && Number.isFinite(options.baseOffsetY)
      ? { x: options.baseOffsetX, y: options.baseOffsetY }
      : this.getTerminalSpawnOffset(options.kind);
    const offset = {
      x: Number.isFinite(options.baseOffsetX) ? options.baseOffsetX : spawnOffset.x,
      y: Number.isFinite(options.baseOffsetY) ? options.baseOffsetY : spawnOffset.y,
    };

    const terminal = new TerminalWindow(this.container, {
      ...options,
      os: normalizeTerminalOs(options.os || this.defaultBootTerminalOs),
      baseOffsetX: offset.x,
      baseOffsetY: offset.y,
      onFocus: (instance) => this.bringTerminalToFront(instance),
      onDestroy: (instance) => this.unregisterTerminal(instance),
    });

    this.terminals.push(terminal);
    this.bringTerminalToFront(terminal);

    return terminal;
  },

  createCommandTerminal(options = {}) {
    const offset = {
      ...this.getTerminalSpawnOffset('command'),
      ...(Number.isFinite(options.baseOffsetX) ? { x: options.baseOffsetX } : {}),
      ...(Number.isFinite(options.baseOffsetY) ? { y: options.baseOffsetY } : {}),
    };
    const terminal = this.createTerminal({
      ...options,
      kind: 'command',
      os: this.defaultBootTerminalOs,
      draggable: true,
      interactive: true,
      showCursor: true,
      wobbleScale: 0.3,
      baseOffsetX: offset.x,
      baseOffsetY: offset.y,
      onCommand: (command, terminal) => this.handleCommandTerminalCommand(command, terminal),
      getCompletions: (prefix) => getCommandCompletions(prefix),
    });

    terminal.root.classList.add('system-terminal--command');
    terminal.appendResponse([
      'popping a shell... type `help` for help',
      '',
    ]);

    this.commandTerminal = terminal;
    return terminal;
  },

  toggleCommandTerminal() {
    if (!this.commandTerminal || this.commandTerminal.destroyed) {
      this.createCommandTerminal();
    }

    if (this.commandTerminal.visible || this.commandTerminal.closing) {
      this.commandTerminal.hide();
      return;
    }

    this.commandTerminal.applyVariant(this.defaultBootTerminalOs);
    this.commandTerminal.open();
    this.bringTerminalToFront(this.commandTerminal);
  },

  handleCommandTerminalCommand(command, terminal) {
    return runTerminalCommand({
      scene: this,
      terminal,
      command,
    });
  },

  enableFreecam(terminal) {
    const lookDirection = new THREE.Vector3();
    this.camera.getWorldDirection(lookDirection);

    this.freecam.active = true;
    this.freecam.terminal = terminal;
    this.freecam.position.copy(this.camera.position);
    this.freecam.lookDirection.copy(lookDirection).normalize();
    this.freecam.yaw = Math.atan2(this.freecam.lookDirection.x, this.freecam.lookDirection.z);
    this.freecam.pitch = Math.asin(THREE.MathUtils.clamp(this.freecam.lookDirection.y, -1, 1));
    this.resetFreecamMovement();

    this.renderer.domElement.requestPointerLock?.();
  },

  resetFreecamMovement() {
    const s = this.freecam.moveState;
    s.forward = s.backward = s.left = s.right = s.boost = false;
  },

  disableFreecam(options = {}) {
    if (!this.freecam.active) return;

    const {
      skipTerminalExit = false,
      releasePointerLock = true,
    } = options;
    const terminal = this.freecam.terminal;

    this.freecam.active = false;
    this.freecam.terminal = null;
    this.resetFreecamMovement();

    if (releasePointerLock && document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }

    if (!skipTerminalExit && terminal?.appMode?.name === './freecam') {
      terminal.exitAppMode({ triggerKey: 'Escape' });
    }
  },

  buildBootScript(template, context) {
    const r = (key) => resolveBootTemplateValue(template[key], context);
    const fingerprintLines = context.fingerprintLines.slice(0, 10);
    const fingerprintBlock = fingerprintLines.length
      ? `${fingerprintLines.join('\n')}${template.fingerprintSuffix ?? '\n'}`
      : '';

    return [
      r('intro'), r('beforeFingerprint'), r('fingerprintCommand'), fingerprintBlock,
      r('probeLine'), { pause: r('probePause') ?? 240 },
      r('uplinkCommand'), r('connectedLine'), r('mountLine'), { pause: 180 },
      r('dumpCommand'), r('dumpLines'), { pause: 320 },
      r('compressionLine'), { pause: 260 },
      `upload target: ${r('uploadTarget')}`,
      r('uploadProgress'), r('cleanupLine'), r('exitLine'),
    ].flat();
  },

  buildBootSequence(bootTerminalOs = this.defaultBootTerminalOs) {
    const normalizedOs = normalizeTerminalOs(bootTerminalOs);
    const template = BOOT_SEQUENCE_TEMPLATES[normalizedOs] ?? BOOT_SEQUENCE_TEMPLATES.WINDOWS;

    return this.buildBootScript(template, {
      normalizedTitle: (this.telemetry.title || 'SIGNAL TELEMETRY').toUpperCase(),
      fingerprintLines: this.telemetry.bootLines,
      loginStamp: formatBootTimestamp(new Date()),
    });
  },

  playStartupTerminal(bootTerminalOs = this.defaultBootTerminalOs) {
    const terminal = this.createTerminal({
      kind: 'boot',
      os: bootTerminalOs,
      draggable: false,
      interactive: false,
      showCursor: false,
      wobbleScale: 1,
    });

    terminal.root.classList.add('system-terminal--boot');
    terminal.playScript(this.buildBootSequence(bootTerminalOs), {
      lineDelay: 80,
      autoCloseDelay: 1000,
      destroyOnClose: true,
    });
  },

  setupEventListeners() {
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.onKeyUp(event));
    window.addEventListener('blur', () => this.onWindowBlur());
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    document.addEventListener('pointerlockerror', () => this.onPointerLockError());
    window.addEventListener('pointerout', (event) => {
      if (!event.relatedTarget) {
        this.pointerActive = false;
        this.pointerVelocity.set(0, 0);
      }
    });
  },

  onPointerMove(event) {
    if (this.freecam.active && document.pointerLockElement === this.renderer.domElement) {
      this.freecam.yaw -= event.movementX * FREECAM_MOUSE_SENSITIVITY;
      this.freecam.pitch = THREE.MathUtils.clamp(
        this.freecam.pitch - event.movementY * FREECAM_MOUSE_SENSITIVITY,
        -FREECAM_MAX_PITCH,
        FREECAM_MAX_PITCH,
      );
      this.pointerActive = false;
      this.pointerVelocity.set(0, 0);
      return;
    }

    const { clientX, clientY } = event;

    if (this.pointerActive) {
      this.pointerVelocity.set(clientX - this.pointerPosition.x, clientY - this.pointerPosition.y);
    } else {
      this.pointerVelocity.set(0, 0);
    }

    this.pointerPosition.set(clientX, clientY);
    this.pointerActive = true;
  },

  isTypingTarget(target) {
    return target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  },

  onKeyDown(event) {
    const key = event.key?.toLowerCase();

    if (this.freecam.active && key !== 'c') {
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        this.disableFreecam();
        return;
      }

      const movementKey = FREECAM_MOVEMENT_KEYS[key];
      if (movementKey) {
        event.preventDefault();
        this.freecam.moveState[movementKey] = true;
        return;
      }

      if (event.key === 'Shift') {
        event.preventDefault();
        this.freecam.moveState.boost = true;
      }

      return;
    }

    if (!this.bootHotkeysEnabled || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.isTypingTarget(event.target)) return;

    if (key === 'c') {
      event.preventDefault();
      this.toggleCommandTerminal();
      return;
    }

    const bootTerminalOs = BOOT_TERMINAL_KEYMAP[key];
    if (!bootTerminalOs) return;

    event.preventDefault();
    this.playStartupTerminal(bootTerminalOs);
  },

  onKeyUp(event) {
    if (!this.freecam.active) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const key = event.key?.toLowerCase();
    const movementKey = FREECAM_MOVEMENT_KEYS[key];
    if (movementKey) {
      this.freecam.moveState[movementKey] = false;
      return;
    }

    if (event.key === 'Shift') {
      this.freecam.moveState.boost = false;
    }
  },

  onWindowBlur() {
    this.pointerActive = false;
    this.pointerVelocity.set(0, 0);

    if (!this.freecam.active) return;
    this.disableFreecam({ releasePointerLock: false });
  },

  onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.onWindowBlur();
    }
  },

  onPointerLockChange() {
    if (!this.freecam.active) return;
    if (document.pointerLockElement === this.renderer.domElement) return;

    this.disableFreecam({ skipTerminalExit: false, releasePointerLock: false });
  },

  onPointerLockError() {
    if (!this.freecam.active) return;
    this.disableFreecam({ releasePointerLock: false });
  },

  updateCamera(time, dt) {
    if (this.freecam.active) {
      const lookDirection = this.freecam.lookDirection.set(
        Math.sin(this.freecam.yaw) * Math.cos(this.freecam.pitch),
        Math.sin(this.freecam.pitch),
        Math.cos(this.freecam.yaw) * Math.cos(this.freecam.pitch),
      ).normalize();
      const strafeDirection = this.freecam.strafeDirection.crossVectors(WORLD_UP, lookDirection).normalize();
      const moveVector = this.freecamMoveVector.set(0, 0, 0);

      if (this.freecam.moveState.forward) moveVector.add(lookDirection);
      if (this.freecam.moveState.backward) moveVector.sub(lookDirection);
      if (this.freecam.moveState.right) moveVector.sub(strafeDirection);
      if (this.freecam.moveState.left) moveVector.add(strafeDirection);

      if (moveVector.lengthSq() > 0) {
        moveVector.normalize().multiplyScalar(
          FREECAM_BASE_SPEED * (this.freecam.moveState.boost ? FREECAM_BOOST_MULTIPLIER : 1) * dt,
        );
        this.freecam.position.add(moveVector);
      }

      this.freecam.lookTarget.copy(this.freecam.position).add(lookDirection);
      this.camera.position.copy(this.freecam.position);
      this.cameraLookAt.copy(this.freecam.lookTarget);
      this.camera.lookAt(this.cameraLookAt);
      return;
    }

    const wobble = events.state.distortion * 0.03 + events.state.bass_hit * 0.014;
    this.cameraOffset.set(
      Math.sin(time * 1.2) * wobble,
      Math.cos(time * 1.45) * wobble * 0.8 + events.state.rms * 0.15,
      Math.sin(time * 0.92 + 0.6) * wobble * 0.5,
    );

    this.camera.position.copy(this.cameraBasePosition).add(this.cameraOffset);
    this.cameraLookAt.lerp(this.cameraTarget, 0.12);
    this.camera.lookAt(this.cameraLookAt);
  },

  updateFloatingPanel(root, prefix, time, isActive = true) {
    if (!root || !isActive) return false;

    const xShift = (Math.sin(time * 2.4) * events.state.fringe * 10).toFixed(2);
    const yShift = (Math.cos(time * 1.7) * events.state.distortion * 6).toFixed(2);

    root.style.setProperty(`--${prefix}-shift-x`, `${xShift}px`);
    root.style.setProperty(`--${prefix}-shift-y`, `${yShift}px`);
    root.style.setProperty(`--${prefix}-opacity`, `${0.62 + events.state.energy * 0.2 + events.state.shimmer * 0.08}`);
    root.style.setProperty(`--${prefix}-glow`, `${0.24 + events.state.shimmer * 0.6 + events.state.fringe * 0.2}`);
    root.style.borderColor = `rgba(121, 235, 255, ${0.2 + events.state.energy * 0.26})`;
    return true;
  },

  updateTelemetryHud(time) {
    if (!this.updateFloatingPanel(this.telemetryRoot, 'terminal', time, this.telemetryRoot?.classList.contains('visible'))) return;
    this.telemetryStatus.style.color = events.state.bass_hit > 0.08 ? '#ff9f67' : '#ff7ee1';
  },

  updateVolumeControl(time) {
    this.updateFloatingPanel(this.volumeControlRoot, 'volume', time, !this.volumeControlRoot?.classList.contains('hidden'));
  },

  updateTerminals(time, dt) {
    const terminals = this.terminals;
    if (terminals.length === 0) return;

    this.pointerState.active = this.pointerActive;

    terminals.forEach((terminal) => {
      terminal.update(time, dt, this.pointerState, events.state, { audio });
    });
  },
};

export function attachTerminalRuntimeMethods(SceneClass) {
  Object.assign(SceneClass.prototype, terminalRuntimeMethods);
}
