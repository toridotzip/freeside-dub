import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { events } from './events.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
//import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { grainShader } from './grain.js';
import { audio } from './audio.js';
import { getCommandCompletions, runTerminalCommand } from './cmd/index.js';
import { TerminalWindow, normalizeTerminalOs } from './terminal.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const MODEL_TARGET_LENGTH = 10;

const CYAN = new THREE.Color(0x7ae7ff);
const BLUE = new THREE.Color(0x6fa0ff);
const PINK = new THREE.Color(0xff7ee1);
const ORANGE = new THREE.Color(0xffa15c);
const regionPulseShader = {
  vertexShader: `
    varying vec3 vLocalPosition;

    void main() {
      vLocalPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uRadius;
    uniform float uPhase;
    uniform vec3 uHalfSize;
    uniform vec3 uFillAxis;
    uniform vec3 uStripeAxis;
    varying vec3 vLocalPosition;

    void main() {
      vec3 normalized = vLocalPosition / max(uHalfSize, vec3(0.001));
      float fillDistance = abs(dot(normalized, uFillAxis));
      float stripeDistance = dot(normalized, uStripeAxis);
      float pulse = 1.0 - smoothstep(uRadius, uRadius + 0.22, fillDistance);
      float stripe = 0.45 + 0.55 * sin((stripeDistance * 6.0 + uPhase) * 6.28318530718);
      float alpha = pulse * stripe * uOpacity;
      gl_FragColor = vec4(uColor, alpha);
    }
  `,
};

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

export class SpaceStationScene {
  constructor(canvasContainer, options = {}) {
    this.container = canvasContainer;
    this.clock = new THREE.Clock();
    this.loader = new GLTFLoader();
    this.telemetry = {
      title: 'Signal telemetry',
      status: 'STANDBY',
      lines: [],
    };
    this.pointerPosition = new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5);
    this.pointerVelocity = new THREE.Vector2();
    this.pointerActive = false;
    this.defaultBootTerminalOs = normalizeTerminalOs(options.bootTerminalOs);
    this.bootHotkeysEnabled = false;
    this.terminals = [];
    this.commandTerminal = null;
    this.nextTerminalSerial = 0;
    this.nextTerminalZIndex = 20;
    this.freecam = {
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
    this.freecamMoveVector = new THREE.Vector3();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x01050a);
    this.scene.fog = new THREE.FogExp2(0x020812, 0.009);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1600);
    this.camera.position.set(0, 2, 24);
    this.cameraBasePosition = new THREE.Vector3(0, 2, 24);
    this.cameraTarget = new THREE.Vector3();
    this.cameraLookAt = new THREE.Vector3();
    this.cameraOffset = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
      stencil: false,
    });
    this.pixelRatio = Math.min(window.devicePixelRatio, 0.5);
    this.bloomDownscaleFactor = 0.75;
    this.maxFps = 60;
    this.frameInterval = 1 / this.maxFps;
    this.accumulatedDt = 0;
    this.domUpdateInterval = 1 / 30;
    this.domAccumulatedDt = 0;
    this.pointerState = {
      active: false,
      position: this.pointerPosition,
      velocity: this.pointerVelocity,
    };
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    /*this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.uniforms.resolution.value.set(
      1 / (window.innerWidth * this.pixelRatio),
      1 / (window.innerHeight * this.pixelRatio),
    );
    this.composer.addPass(this.fxaaPass);*/

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth * this.bloomDownscaleFactor, window.innerHeight * this.bloomDownscaleFactor),
      1.24,
      0.35,
      0.52,
    );
    this.bloomPass.threshold = 0.08;
    this.composer.addPass(this.bloomPass);

    this.grainPass = new ShaderPass(grainShader);
    this.composer.addPass(this.grainPass);
    this.composer.addPass(new OutputPass());

    this.stationAnchor = new THREE.Group();
    this.stationAnchor.rotation.set(-0.18, 0.48, 0.06);
    this.scene.add(this.stationAnchor);

    this.stationSpinGroup = new THREE.Group();
    this.stationAnchor.add(this.stationSpinGroup);

    this.stationModelGroup = new THREE.Group();
    this.stationSpinGroup.add(this.stationModelGroup);

    this.stationAxis = new THREE.Vector3(1, 0, 0);
    this.stationPlaneU = new THREE.Vector3(0, 1, 0);
    this.stationPlaneV = new THREE.Vector3(0, 0, 1);
    this.stationSpinAngle = 0;

    this.stationBounds = new THREE.Vector3(8, 5, 6);
    this.stationLength = MODEL_TARGET_LENGTH;
    this.stationRadius = 4.2;
    this.baseModelScale = 1;
    this.stationModel = null;

    this.sharedStationHullMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: true,
      depthTest: true,
    });
    this.sharedPanelMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: true,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.sharedInvisibleMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      toneMapped: false,
      depthWrite: false,
      depthTest: true,
    });
    this.sharedInvisibleMaterial.colorWrite = false;
    this.wireMaterials = {
      body: new THREE.LineBasicMaterial({ color: 0x5dd7ff, transparent: true, opacity: 0.36, toneMapped: false }),
      panels: new THREE.LineBasicMaterial({ color: 0x7ae7ff, transparent: true, opacity: 0.48, toneMapped: false }),
      core: new THREE.LineBasicMaterial({ color: 0xff89e2, transparent: true, opacity: 0.52, toneMapped: false }),
      fore: new THREE.LineBasicMaterial({ color: 0x89d8ff, transparent: true, opacity: 0.45, toneMapped: false }),
      aft: new THREE.LineBasicMaterial({ color: 0xffa76f, transparent: true, opacity: 0.52, toneMapped: false }),
    };
    this.vertexMaterials = {
      body: new THREE.PointsMaterial({ color: 0x88ecff, size: 0.055, transparent: true, opacity: 0.42, toneMapped: false }),
      core: new THREE.PointsMaterial({ color: 0xff97e6, size: 0.065, transparent: true, opacity: 0.64, toneMapped: false }),
      fore: new THREE.PointsMaterial({ color: 0x9ce4ff, size: 0.06, transparent: true, opacity: 0.54, toneMapped: false }),
      aft: new THREE.PointsMaterial({ color: 0xffb07a, size: 0.06, transparent: true, opacity: 0.6, toneMapped: false }),
    };

    this.panelEntries = [];
    this.forePanelBars = [];
    this.aftPanelBars = [];
    this.bodyWires = [];
    this.coreWires = [];
    this.foreWires = [];
    this.aftWires = [];
    this.bodyVertices = [];
    this.coreVertices = [];
    this.foreVertices = [];
    this.aftVertices = [];
    this.coreEffects = [];
    this.foreEffects = [];
    this.aftEffects = [];

    this.tempPoint = new THREE.Vector3();
    this.tempRadial = new THREE.Vector3();
    this.tempDummy = new THREE.Object3D();
    this.tempBox = new THREE.Box3();

    this.setupLighting();
    this.createBackground();
    this.createTelemetryHud();
    this.loadStationModel();
    this.setupEventListeners();

    this.composer.render();
  }

  setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x182635, 0.72));
    this.scene.add(new THREE.HemisphereLight(0x80d8ff, 0x01050b, 0.86));

    this.keyLight = new THREE.DirectionalLight(0xa8e5ff, 1.9);
    this.keyLight.position.set(12, 14, 14);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.PointLight(0x64dcff, 12, 120);
    this.rimLight.position.set(-10, 7, 16);
    this.scene.add(this.rimLight);

    this.warmLight = new THREE.PointLight(0xff955f, 8, 100);
    this.warmLight.position.set(-8, -4, -10);
    this.scene.add(this.warmLight);

    this.fillLight = new THREE.PointLight(0x6d8eff, 7, 90);
    this.fillLight.position.set(6, 3, -8);
    this.scene.add(this.fillLight);
  }

  createBackground() {
    const starCount = 5200;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const radius = 180 + Math.random() * 650;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const color = new THREE.Color().setHSL(0.56 + Math.random() * 0.08, 0.42, 0.72 + Math.random() * 0.16);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.starfield = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ size: 1.45, vertexColors: true, transparent: true, opacity: 0.9, fog: false }),
    );
    this.starfield.frustumCulled = false;
    this.scene.add(this.starfield);

    this.backdropArcs = new THREE.Group();
    [32, 44, 58].forEach((radius, index) => {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.06, 8, 128),
        new THREE.MeshBasicMaterial({
          color: index === 1 ? 0xff90e8 : 0x59d6ff,
          transparent: true,
          opacity: index === 1 ? 0.08 : 0.05,
          toneMapped: false,
        }),
      );
      arc.position.z = -96;
      arc.rotation.z = index * 0.2;
      arc.scale.y = 0.42;
      this.backdropArcs.add(arc);
    });
    this.scene.add(this.backdropArcs);
  }

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
  }

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
  }

  setTelemetry(telemetry) {
    this.telemetry = {
      title: telemetry?.title || 'Signal telemetry',
      status: telemetry?.status || 'STANDBY',
      lines: Array.isArray(telemetry?.lines) ? telemetry.lines : [],
      bootLines: Array.isArray(telemetry?.bootLines) ? telemetry.bootLines : [],
    };
    this.renderTelemetryHud();
  }

  setTelemetryVisible(isVisible) {
    if (!this.telemetryRoot) return;
    this.telemetryRoot.classList.toggle('visible', isVisible);
  }

  setVolumeControl(element) {
    this.volumeControlRoot = element;
  }

  setBootTerminalOs(bootTerminalOs) {
    this.defaultBootTerminalOs = normalizeTerminalOs(bootTerminalOs);

    if (this.commandTerminal && !this.commandTerminal.destroyed) {
      this.commandTerminal.applyVariant(this.defaultBootTerminalOs);
    }
  }

  enableBootTerminalHotkeys() {
    this.bootHotkeysEnabled = true;
  }

  bringTerminalToFront(terminal) {
    if (!terminal || terminal.destroyed) return;
    terminal.setZIndex(this.nextTerminalZIndex);
    this.nextTerminalZIndex += 1;
  }

  unregisterTerminal(terminal) {
    this.terminals = this.terminals.filter((entry) => entry !== terminal);

    if (this.commandTerminal === terminal) {
      this.commandTerminal = null;
    }

    if (this.freecam.terminal === terminal) {
      this.disableFreecam({ skipTerminalExit: true, releasePointerLock: true });
    }
  }

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
  }

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
  }

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
  }

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
  }

  handleCommandTerminalCommand(command, terminal) {
    return runTerminalCommand({
      scene: this,
      terminal,
      command,
    });
  }

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
  }

  resetFreecamMovement() {
    this.freecam.moveState.forward = false;
    this.freecam.moveState.backward = false;
    this.freecam.moveState.left = false;
    this.freecam.moveState.right = false;
    this.freecam.moveState.boost = false;
  }

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
  }

  buildWindowsBootSequence(normalizedTitle, fingerprintLines) {
    const fingerprintBlock = fingerprintLines.length ? `${fingerprintLines.join('\n')}\n` : '';

    return [
      `Microsoft Windows [Version 10.0.19045.4291]`,
      `(c) Microsoft Corporation. All rights reserved.`,
      { pause: 220 },
      `C:\\>cd Windows\\freeside`,
      `C:\\Windows\\freeside>`,
      `C:\\Windows\\freeside>fingerprint.exe /quiet /ua /hooks /ext`,
      fingerprintBlock,
      `Probe   browser shell ........ slightly cursed`,
      { pause: 260 },
      `C:\\Windows\\freeside>uplink.exe /fast /shadowMount /spoof`,
      `Connected to ${normalizedTitle}`,
      `Mount   \\\\.\\relay\\upload ...... OK`,
      { pause: 180 },
      [
        `C:\\Windows\\freeside>dump.bat`,
        `scanning...`,
        { pause: 320 },
        `envs ...................DONE`,
        `mem dump ...............DONE`,
        `browser session ........DONE`,
        `system keyring .........DONE`,
        `Access denied - C:\\Windows\\pagefile.sys`,
        `Access denied - C:\\Windows\\swapfile.sys`,
        `Access denied - C:\\Windows\\system32`,
        `elevating to SYSTEM ....................nailed it.`,
        `wallets ................DONE`,
        `cookies ................DONE`,
        { pause: 320 },
        `zipping...`,
        { pause: 260 },
        `upload target: \\\\.\\relay\\upload`,
        `uploading .............. 12 % `,
        `uploading .............. 29 % `,
        `uploading .............. 51 % `,
        `uploading .............. 92 % `,
        `cleaning up .............OK`,
        `C:\\> exit`,
      ].flat(),
    ].flat();
  }

  buildMacBootSequence(normalizedTitle, fingerprintLines) {
    const loginStamp = formatBootTimestamp(new Date());
    const fingerprintBlock = fingerprintLines.length ? `${fingerprintLines.join('\n')}\n` : '';

    return [
      `Last login: ${loginStamp} on console`,
      `root@localhost ~ % cd /Volumes/Freeside`,
      `root@localhost Freeside % ./fingerprint --quiet --ua --hooks --ext`,
      fingerprintBlock,
      `probe.shell = Terminal.app / zsh`,
      { pause: 240 },
      `root@localhost Freeside % ./uplink --fast --shadow-mount --spoof`,
      `connected -> ${normalizedTitle}`,
      `mount /Volumes/relay/upload ........ok`,
      { pause: 180 },
      `root@localhost Freeside % ./dump.sh`,
      `scanning...`,
      { pause: 320 },
      `launch agents .................done`,
      `memory pages ..................done`,
      `browser session ...............done`,
      `keychain sweep ................done`,
      `/System/Library: Operation not permitted`,
      `/private/var/vm/sleepimage: Operation not permitted`,
      `/private/var/vm/swapfile0: Operation not permitted`,
      `sudo escalation ........................accepted.`,
      `wallets .......................done`,
      `cookies .......................done`,
      { pause: 320 },
      'compressing...',
      { pause: 260 },
      'upload target: /Volumes/relay/upload',
      'uploading ..................... 14%',
      'uploading ..................... 33%',
      'uploading ..................... 57%',
      'uploading ..................... 95%\n',
      'cleanup ....................... ok',
      'root@localhost Freeside % exit',
    ];
  }

  buildLinuxBootSequence(normalizedTitle, fingerprintLines) {
    const fingerprintBlock = fingerprintLines.length ? `${fingerprintLines.join('\n')} \n` : '';

    return [
      `root@localhost:~$ cd /opt/freeside/`,
      `root@localhost:/opt/freeside$ ./fingerprint --quiet --ua --hooks --ext`,
      fingerprintBlock,
      `probe.shell = bash`,
      { pause: 240 },
      `root@localhost:/opt/freeside$ ./uplink --fast --shadow-mount --spoof`,
      `connected -> ${normalizedTitle}`,
      `mount / mnt / relay / upload ............ok`,
      { pause: 180 },
      `root@localhost:/opt/freeside$ ./dump.sh`,
      `scanning...`,
      { pause: 320 },
      `env snapshots ...................... done`,
      `memory scrape ...................... done`,
      `browser session .................... done`,
      `credential store ................... done`,
      `/etc/shadow: Permission denied`,
      `/proc/kcore: Permission denied`,
      `/root: Permission denied`,
      `sudo escalation ........................ acquired.`,
      `wallets ............................ done`,
      `cookies ............................ done`,
      { pause: 320 },
      `compressing...`,
      { pause: 260 },
      `upload target: /mnt/relay/upload`,
      `uploading .......................... 11%`,
      `uploading .......................... 36%`,
      `uploading .......................... 63%`,
      `uploading .......................... 97%`,
      `cleanup ............................ ok`,
      `root@localhost:/opt/freeside$ exit`,
    ];
  }

  buildBootSequence(bootTerminalOs = this.defaultBootTerminalOs) {
    const normalizedTitle = (this.telemetry.title || 'SIGNAL TELEMETRY').toUpperCase();
    const fingerprintLines = this.telemetry.bootLines.slice(0, 10);
    const normalizedOs = normalizeTerminalOs(bootTerminalOs);

    if (normalizedOs === 'MACOS') {
      return this.buildMacBootSequence(normalizedTitle, fingerprintLines);
    }

    if (normalizedOs === 'LINUX') {
      return this.buildLinuxBootSequence(normalizedTitle, fingerprintLines);
    }

    return this.buildWindowsBootSequence(normalizedTitle, fingerprintLines);
  }

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
  }

  loadStationModel() {
    this.loader.load(
      '/station.glb',
      (gltf) => this.setStationModel(gltf.scene),
      undefined,
      (error) => {
        console.error('Failed to load /station.glb', error);
      },
    );
  }

  setStationModel(model) {
    this.stationModelGroup.clear();
    this.panelEntries = [];
    this.forePanelBars = [];
    this.aftPanelBars = [];
    this.bodyWires = [];
    this.coreWires = [];
    this.foreWires = [];
    this.aftWires = [];
    this.bodyVertices = [];
    this.coreVertices = [];
    this.foreVertices = [];
    this.aftVertices = [];
    this.coreEffects = [];
    this.foreEffects = [];
    this.aftEffects = [];

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const scale = MODEL_TARGET_LENGTH / longest;

    model.position.sub(center);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);

    this.stationModel = model;
    this.stationModelGroup.add(model);

    this.stationBounds.copy(size).multiplyScalar(scale);
    this.baseModelScale = scale;
    this.stationLength = Math.max(this.stationBounds.x, this.stationBounds.y, this.stationBounds.z);
    this.detailWireThreshold = Math.max(0.14, this.stationLength * 0.012);
    this.detailVertexThreshold = Math.max(0.2, this.stationLength * 0.016);
    this.panelGlowThreshold = Math.max(0.24, this.stationLength * 0.02);
    this.regionEffectThreshold = Math.max(0.42, this.stationLength * 0.03);
    const sortedBounds = [this.stationBounds.x, this.stationBounds.y, this.stationBounds.z].sort((a, b) => b - a);
    this.stationRadius = Math.max(2.8, (sortedBounds[1] + sortedBounds[2]) * 0.3 + 0.8);
    this.stationAxis.copy(this.computeBodyAxis(model));
    this.updateAxisBasis();
    this.buildStationPresentation();
    this.fitCameraToStation();
  }

  isPanelMesh(scaledSize) {
    const sortedSize = [scaledSize.x, scaledSize.y, scaledSize.z].sort((a, b) => a - b);
    const minDim = sortedSize[0];
    const midDim = sortedSize[1];
    const maxDim = sortedSize[2];

    return maxDim > 3 && midDim / maxDim < 0.08 && minDim / maxDim < 0.02;
  }

  computeBodyAxis(model) {
    const covariance = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const transformed = new THREE.Vector3();
    const localPoint = new THREE.Vector3();
    const direction = new THREE.Vector3(1, 0, 0);
    const spinLocalInverse = new THREE.Matrix4().copy(this.stationSpinGroup.matrixWorld).invert();
    let sampleCount = 0;

    model.updateMatrixWorld(true);

    model.traverse((child) => {
      if (!child.isMesh) return;

      const scaledSize = new THREE.Box3().setFromObject(child).getSize(new THREE.Vector3());
      if (this.isPanelMesh(scaledSize)) return;

      const position = child.geometry.attributes.position;
      if (!position) return;

      for (let i = 0; i < position.count; i += 3) {
        transformed.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
        localPoint.copy(transformed).applyMatrix4(spinLocalInverse);
        covariance[0][0] += localPoint.x * localPoint.x;
        covariance[0][1] += localPoint.x * localPoint.y;
        covariance[0][2] += localPoint.x * localPoint.z;
        covariance[1][0] += localPoint.y * localPoint.x;
        covariance[1][1] += localPoint.y * localPoint.y;
        covariance[1][2] += localPoint.y * localPoint.z;
        covariance[2][0] += localPoint.z * localPoint.x;
        covariance[2][1] += localPoint.z * localPoint.y;
        covariance[2][2] += localPoint.z * localPoint.z;
        sampleCount++;
      }
    });

    if (sampleCount === 0) return new THREE.Vector3(1, 0, 0);

    for (let iteration = 0; iteration < 12; iteration++) {
      const x = covariance[0][0] * direction.x + covariance[0][1] * direction.y + covariance[0][2] * direction.z;
      const y = covariance[1][0] * direction.x + covariance[1][1] * direction.y + covariance[1][2] * direction.z;
      const z = covariance[2][0] * direction.x + covariance[2][1] * direction.y + covariance[2][2] * direction.z;
      direction.set(x, y, z).normalize();
    }

    return direction.normalize();
  }

  buildStationPresentation() {
    this.stationModel.updateMatrixWorld(true);
    const sourceMeshes = [];
    this.stationModel.traverse((child) => {
      if (child.isMesh && !child.userData.stationOverlay) sourceMeshes.push(child);
    });

    sourceMeshes.forEach((child) => {
      if (!child.isMesh) return;

      const geometry = child.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();

      const localSize = geometry.boundingBox.getSize(new THREE.Vector3());
      const scaledSize = new THREE.Box3().setFromObject(child).getSize(new THREE.Vector3());
      const scaledMaxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
      const buildWireOverlay = scaledMaxDim >= this.detailWireThreshold;
      const buildVertexOverlay = scaledMaxDim >= this.detailVertexThreshold;
      const buildPanelGlow = scaledMaxDim >= this.panelGlowThreshold;
      const buildRegionEffect = scaledMaxDim >= this.regionEffectThreshold;
      const isPanel = this.isPanelMesh(scaledSize);

      child.material = Array.isArray(child.material)
        ? child.material.map(() => this.sharedInvisibleMaterial)
        : this.sharedInvisibleMaterial;
      child.renderOrder = 0;

      const worldBox = this.tempBox.setFromObject(child);
      const worldCenter = worldBox.getCenter(new THREE.Vector3());
      const localCenter = this.stationModel.worldToLocal(worldCenter.clone());
      const axial = localCenter.dot(this.stationAxis);

      let wireMaterial = this.wireMaterials.body;
      if (isPanel) {
        wireMaterial = this.wireMaterials.panels;
      } else if (Math.abs(axial) < this.stationLength * 0.16) {
        wireMaterial = this.wireMaterials.core;
      } else if (axial > 0) {
        wireMaterial = this.wireMaterials.fore;
      } else {
        wireMaterial = this.wireMaterials.aft;
      }

      let wire = null;
      if (buildWireOverlay) {
        wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wireMaterial);
        wire.renderOrder = 4;
        child.add(wire);
      }

      this.createHullLayer(child, isPanel ? this.sharedPanelMaterial : this.sharedStationHullMaterial, isPanel ? 2 : 1);

      if (isPanel) {
        const localCenter = geometry.boundingBox.getCenter(new THREE.Vector3());
        if (buildPanelGlow) {
          this.panelEntries.push(this.createPanelOverlay(child, localCenter, localSize));
        }
      } else if (wireMaterial === this.wireMaterials.core) {
        if (wire) this.coreWires.push(wire);
        if (buildVertexOverlay) this.coreVertices.push(this.createVertexLayer(child, this.vertexMaterials.core));
        if (buildRegionEffect) this.createAttachedEffect(child, localSize, 'core');
      } else if (wireMaterial === this.wireMaterials.fore) {
        if (wire) this.foreWires.push(wire);
        if (buildVertexOverlay) this.foreVertices.push(this.createVertexLayer(child, this.vertexMaterials.fore));
        if (buildRegionEffect) this.createRegionPulseEffect(child, localSize, 'fore');
      } else if (wireMaterial === this.wireMaterials.aft) {
        if (wire) this.aftWires.push(wire);
        if (buildVertexOverlay) this.aftVertices.push(this.createVertexLayer(child, this.vertexMaterials.aft));
        if (buildRegionEffect) this.createRegionPulseEffect(child, localSize, 'aft');
      } else {
        if (wire) this.bodyWires.push(wire);
        if (buildVertexOverlay) this.bodyVertices.push(this.createVertexLayer(child, this.vertexMaterials.body));
      }
    });
  }

  createVertexLayer(mesh, material) {
    const vertices = new THREE.Points(mesh.geometry, material);
    vertices.renderOrder = 6;
    mesh.add(vertices);
    return vertices;
  }

  createHullLayer(mesh, material, renderOrder) {
    const hull = new THREE.Mesh(mesh.geometry, material);
    hull.userData.stationOverlay = true;
    hull.renderOrder = renderOrder;
    hull.position.copy(mesh.position);
    hull.quaternion.copy(mesh.quaternion);
    hull.scale.copy(mesh.scale);
    mesh.parent?.add(hull);
    return hull;
  }

  createAttachedEffect(mesh, localSize, region) {
    const size = Math.max(localSize.x, localSize.y, localSize.z);
    if (size < 0.35) return;

    const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
    let effect;

    if (region === 'core') {
      effect = new THREE.Mesh(
        new THREE.IcosahedronGeometry(Math.max(0.04, size * 0.12), 0),
        new THREE.MeshBasicMaterial({
          color: 0xff90e8,
          transparent: true,
          opacity: 0.22,
          wireframe: true,
          depthWrite: false,
          depthTest: true,
          toneMapped: false,
        }),
      );
      this.coreEffects.push(effect);
    } else {
      return;
    }

    effect.position.copy(center);
    effect.renderOrder = 7;
    mesh.add(effect);
  }

  createPanelOverlay(mesh, localCenter, localSize) {
    const dims = [localSize.x, localSize.y, localSize.z];
    const thicknessAxis = dims.indexOf(Math.min(...dims));
    const planeAxes = [0, 1, 2].filter((axis) => axis !== thicknessAxis);
    const width = dims[planeAxes[0]] * 1.02;
    const height = dims[planeAxes[1]] * 1.02;
    const faceInset = Math.max(0.008, dims[thicknessAxis] * 0.18);
    const faceOffset = dims[thicknessAxis] * 0.5 + faceInset;
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x84ebff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), glowMaterial);

    if (thicknessAxis === 0) plane.rotation.y = Math.PI / 2;
    if (thicknessAxis === 1) plane.rotation.x = -Math.PI / 2;

    plane.position.copy(localCenter);
    plane.position.setComponent(thicknessAxis, plane.position.getComponent(thicknessAxis) + faceOffset);
    plane.renderOrder = 5;
    mesh.add(plane);

    const planeBack = plane.clone();
    planeBack.material = glowMaterial.clone();
    planeBack.position.copy(localCenter);
    planeBack.position.setComponent(thicknessAxis, planeBack.position.getComponent(thicknessAxis) - faceOffset);
    planeBack.renderOrder = 5;
    mesh.add(planeBack);

    return {
      mesh,
      frontMaterial: glowMaterial,
      backMaterial: planeBack.material,
    };
  }

  createRegionPulseEffect(mesh, localSize, region) {
    const dims = [localSize.x, localSize.y, localSize.z];
    const axisOrder = [0, 1, 2].sort((a, b) => dims[b] - dims[a]);
    const fillAxis = new THREE.Vector3();
    fillAxis.setComponent(axisOrder[0], 1);
    const stripeAxis = new THREE.Vector3();
    stripeAxis.setComponent(axisOrder[1] ?? axisOrder[0], 1);
    const halfSize = new THREE.Vector3(
      Math.max(localSize.x * 0.5, 0.001),
      Math.max(localSize.y * 0.5, 0.001),
      Math.max(localSize.z * 0.5, 0.001),
    );
    const baseColor = new THREE.Color(region === 'fore' ? 0x72b8ff : 0xffa15c);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: baseColor.clone() },
        uOpacity: { value: 0.0 },
        uRadius: { value: 0.3 },
        uPhase: { value: 0.0 },
        uHalfSize: { value: halfSize },
        uFillAxis: { value: fillAxis },
        uStripeAxis: { value: stripeAxis },
      },
      vertexShader: regionPulseShader.vertexShader,
      fragmentShader: regionPulseShader.fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const effect = new THREE.Mesh(mesh.geometry, material);
    effect.renderOrder = 8;
    mesh.add(effect);

    const target = region === 'fore' ? this.foreEffects : this.aftEffects;
    target.push({
      mesh: effect,
      material,
      baseColor,
    });
  }

  updateAxisBasis() {
    const reference = Math.abs(this.stationAxis.dot(WORLD_UP)) > 0.92 ? WORLD_RIGHT : WORLD_UP;
    this.stationPlaneU.crossVectors(reference, this.stationAxis).normalize();
    this.stationPlaneV.crossVectors(this.stationAxis, this.stationPlaneU).normalize();
  }

  fitCameraToStation() {
    const maxDimension = Math.max(this.stationBounds.x, this.stationBounds.y, this.stationBounds.z, 1);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (maxDimension * 0.5) / Math.tan(fov * 0.5);
    const framedDistance = distance * 1;

    this.cameraBasePosition.set(0, Math.max(1.8, this.stationBounds.y * 0.14), framedDistance);
    this.cameraTarget.set(0, 0, 0);
    this.camera.position.copy(this.cameraBasePosition);
    this.camera.lookAt(this.cameraTarget);
  }

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
  }

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
  }

  isTypingTarget(target) {
    return target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  }

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
        return;
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
  }

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
  }

  onWindowBlur() {
    this.pointerActive = false;
    this.pointerVelocity.set(0, 0);

    if (!this.freecam.active) return;
    this.disableFreecam({ releasePointerLock: false });
  }

  onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.onWindowBlur();
    }
  }

  onPointerLockChange() {
    if (!this.freecam.active) return;
    if (document.pointerLockElement === this.renderer.domElement) return;

    this.disableFreecam({ skipTerminalExit: false, releasePointerLock: false });
  }

  onPointerLockError() {
    if (!this.freecam.active) return;
    this.disableFreecam({ releasePointerLock: false });
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    /*this.fxaaPass.uniforms.resolution.value.set(
      1 / (window.innerWidth * this.pixelRatio),
      1 / (window.innerHeight * this.pixelRatio),
    );*/
    this.bloomPass.setSize(window.innerWidth * this.bloomDownscaleFactor, window.innerHeight * this.bloomDownscaleFactor);
  }

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
  }

  updateStationMotion(time, dt) {
    const spinSpeed = 0.14 + events.state.globalSpeed * 0.2 + events.state.bands.lowmid * 0.08;
    this.stationSpinAngle += dt * spinSpeed;
    this.stationSpinGroup.quaternion.setFromAxisAngle(this.stationAxis, this.stationSpinAngle);

    this.stationAnchor.position.y = Math.sin(time * 0.42) * 0.26 + events.state.rms * 0.34;
    this.stationAnchor.rotation.x = -0.18 + Math.sin(time * 0.1) * 0.03 + events.state.bands.mid * 0.025;
    this.stationAnchor.rotation.y = 0.48 + events.state.bands.lowmid * 0.04;
    this.stationAnchor.rotation.z = 0.06 + Math.sin(time * 0.05) * 0.025 - events.state.centroid * 0.04;

    if (this.stationModel) {
      const modelScale = 1 + events.state.pulse * 0.028 + events.state.bass_hit * 0.016;
      this.stationModel.scale.setScalar(this.baseModelScale * modelScale);
    }
  }

  updateStationStyling(time) {
    const { bands, bass_hit: bassHit, pulse, shimmer, sweep, centroid, rms } = events.state;

    this.wireMaterials.panels.color.copy(CYAN).lerp(BLUE, bands.lowmid * 0.3).lerp(PINK, shimmer * 0.14);
    this.wireMaterials.panels.opacity = 0.38 + bands.lowmid * 0.22 + shimmer * 0.12;

    this.wireMaterials.core.color.copy(PINK).lerp(CYAN, sweep * 0.24);
    this.wireMaterials.core.opacity = 0.34 + bands.mid * 0.32 + sweep * 0.12;

    this.wireMaterials.fore.color.copy(CYAN).lerp(BLUE, centroid * 0.24);
    this.wireMaterials.fore.opacity = 0.28 + shimmer * 0.24 + centroid * 0.12;

    this.wireMaterials.aft.color.copy(ORANGE).lerp(PINK, bassHit * 0.12);
    this.wireMaterials.aft.opacity = 0.34 + bassHit * 0.28 + pulse * 0.12;

    this.wireMaterials.body.color.copy(CYAN).lerp(BLUE, sweep * 0.18);
    this.wireMaterials.body.opacity = 0.24 + pulse * 0.16;

    this.vertexMaterials.body.color.copy(CYAN).lerp(BLUE, sweep * 0.18);
    this.vertexMaterials.body.opacity = 0.28 + pulse * 0.18;
    this.vertexMaterials.core.color.copy(PINK).lerp(CYAN, sweep * 0.2);
    this.vertexMaterials.core.opacity = 0.46 + bands.mid * 0.24 + sweep * 0.14;
    this.vertexMaterials.fore.color.copy(CYAN).lerp(BLUE, centroid * 0.2);
    this.vertexMaterials.fore.opacity = 0.36 + shimmer * 0.22 + centroid * 0.1;
    this.vertexMaterials.aft.color.copy(ORANGE).lerp(PINK, pulse * 0.12);
    this.vertexMaterials.aft.opacity = 0.4 + bassHit * 0.22 + pulse * 0.1;

    this.panelEntries.forEach((entry, index) => {
      const intensity = bands.lowmid * 0.58 + shimmer * 0.42 + Math.sin(time * 1.3 + index * 0.7) * 0.04;
      const opacity = Math.max(0, intensity - 0.16) * 0.34;
      entry.frontMaterial.color.copy(CYAN).lerp(PINK, shimmer * 0.18);
      entry.backMaterial.color.copy(CYAN).lerp(BLUE, bands.high * 0.2);
      entry.frontMaterial.opacity = opacity;
      entry.backMaterial.opacity = opacity * 0.82;
    });

    this.coreEffects.forEach((effect, index) => {
      const scale = 1 + bands.mid * 0.5 + sweep * 0.18 + Math.sin(time * 1.8 + index) * 0.06;
      effect.scale.setScalar(scale);
      effect.material.opacity = 0.12 + bands.mid * 0.22 + sweep * 0.12;
      effect.material.color.copy(PINK).lerp(CYAN, sweep * 0.22);
      effect.rotation.x = time * (0.5 + index * 0.03);
      effect.rotation.y = time * (0.8 + index * 0.04);
    });

    this.foreEffects.forEach((effect, index) => {
      effect.material.uniforms.uRadius.value = THREE.MathUtils.clamp(0.16 + centroid * 0.34 + shimmer * 0.08, 0.12, 0.72);
      effect.material.uniforms.uOpacity.value = 0.18 + shimmer * 0.2 + centroid * 0.24;
      effect.material.uniforms.uPhase.value = time * 0.65 + index * 0.18;
      effect.material.uniforms.uColor.value.copy(effect.baseColor).lerp(CYAN, shimmer * 0.16);
    });

    this.aftEffects.forEach((effect, index) => {
      effect.material.uniforms.uRadius.value = THREE.MathUtils.clamp(0.14 + bassHit * 0.3 + pulse * 0.14, 0.12, 0.68);
      effect.material.uniforms.uOpacity.value = 0.2 + bassHit * 0.22 + pulse * 0.16;
      effect.material.uniforms.uPhase.value = time * 0.52 + index * 0.16;
      effect.material.uniforms.uColor.value.copy(effect.baseColor).lerp(PINK, pulse * 0.12);
    });

    this.starfield.rotation.y = time * 0.008;
    this.backdropArcs.rotation.z = time * 0.016;
  }

  updatePostProcessing(time) {
    this.bloomPass.strength = 0.42 + events.state.pulse * 0.24 + events.state.shimmer * 0.2;
    this.bloomPass.radius = 0.42 + events.state.centroid * 0.16;
    this.renderer.toneMappingExposure = 0.98 + events.state.energy * 0.12 + events.state.rms * 0.08;

    this.grainPass.uniforms.u_time.value = time;
    this.grainPass.uniforms.u_strength.value = 0.022 + events.state.energy * 0.014;
    this.grainPass.uniforms.u_scanline.value = 0.05 + events.state.shimmer * 0.05;
    this.grainPass.uniforms.u_fringe.value = events.state.fringe * 0.24 + events.state.distortion * 0.14;

    this.rimLight.intensity = 10 + events.state.pulse * 4;
    this.warmLight.intensity = 7 + events.state.bass_hit * 4.2;
    this.fillLight.intensity = 6 + events.state.centroid * 2.4;
  }

  updateTelemetryHud(time) {
    if (!this.telemetryRoot || !this.telemetryRoot.classList.contains('visible')) return;

    const xShift = (Math.sin(time * 2.4) * events.state.fringe * 10).toFixed(2);
    const yShift = (Math.cos(time * 1.7) * events.state.distortion * 6).toFixed(2);

    this.telemetryRoot.style.setProperty('--terminal-shift-x', `${xShift}px`);
    this.telemetryRoot.style.setProperty('--terminal-shift-y', `${yShift}px`);
    this.telemetryRoot.style.setProperty('--terminal-opacity', `${0.62 + events.state.energy * 0.2 + events.state.shimmer * 0.08}`);
    this.telemetryRoot.style.setProperty('--terminal-glow', `${0.24 + events.state.shimmer * 0.6 + events.state.fringe * 0.2}`);
    this.telemetryRoot.style.borderColor = `rgba(121, 235, 255, ${0.2 + events.state.energy * 0.26})`;
    this.telemetryStatus.style.color = events.state.bass_hit > 0.08 ? '#ff9f67' : '#ff7ee1';
  }

  updateVolumeControl(time) {
    if (!this.volumeControlRoot || this.volumeControlRoot.classList.contains('hidden')) return;

    const xShift = (Math.sin(time * 2.4) * events.state.fringe * 10).toFixed(2);
    const yShift = (Math.cos(time * 1.7) * events.state.distortion * 6).toFixed(2);

    this.volumeControlRoot.style.setProperty('--volume-shift-x', `${xShift}px`);
    this.volumeControlRoot.style.setProperty('--volume-shift-y', `${yShift}px`);
    this.volumeControlRoot.style.setProperty('--volume-opacity', `${0.62 + events.state.energy * 0.2 + events.state.shimmer * 0.08}`);
    this.volumeControlRoot.style.setProperty('--volume-glow', `${0.24 + events.state.shimmer * 0.6 + events.state.fringe * 0.2}`);
    this.volumeControlRoot.style.borderColor = `rgba(121, 235, 255, ${0.2 + events.state.energy * 0.26})`;
  }

  updateTerminals(time, dt) {
    if (this.terminals.length === 0) return;

    this.pointerState.active = this.pointerActive;

    this.terminals.forEach((terminal) => {
      terminal.update(time, dt, this.pointerState, events.state, { audio });
    });
  }

  update() {
    const dt = this.clock.getDelta();
    this.accumulatedDt += dt;
    if (this.accumulatedDt < this.frameInterval) return;

    const frameDt = this.frameInterval;
    this.accumulatedDt %= this.frameInterval;
    const time = this.clock.getElapsedTime();

    this.updateCamera(time, frameDt);
    this.updateStationMotion(time, frameDt);
    this.updateStationStyling(time);
    this.updatePostProcessing(time);
    this.domAccumulatedDt += frameDt;
    if (this.domAccumulatedDt >= this.domUpdateInterval) {
      const domDt = this.domAccumulatedDt;
      this.domAccumulatedDt %= this.domUpdateInterval;

      this.updateTelemetryHud(time);
      this.updateVolumeControl(time);
      this.updateTerminals(time, domDt);
    }

    this.composer.render();
  }
}
