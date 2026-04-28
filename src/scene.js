import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
//import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { grainShader } from "./shader/grain.js";
import { events } from "./events.js";
import {
  attachStationVisualMethods,
  initializeStationVisualState,
} from "./scene/station-visuals.js";
import {
  attachTerminalRuntimeMethods,
  initializeTerminalRuntimeState,
} from "./scene/terminal-runtime.js";
const QUALITY_PROFILES = [
  {
    name: "low",
    maxFps: 30,
    pixelRatioCap: 0.38,
    maxRenderPixels: 430000,
    bloomDownscaleFactor: 0.42,
    enableBloom: false,
    enableGrain: true,
    showPanelGlow: false,
    showVertices: false,
    showRegionEffects: false,
    showBackdropArcs: false,
    starOpacity: 0.38,
    starCount: 2000,
  },
  {
    name: "medium",
    maxFps: 48,
    pixelRatioCap: 0.5,
    maxRenderPixels: 620000,
    bloomDownscaleFactor: 0.56,
    enableBloom: true,
    enableGrain: true,
    showPanelGlow: false,
    showVertices: true,
    showRegionEffects: false,
    showBackdropArcs: true,
    starOpacity: 0.5,
    starCount: 4000,
  },
  {
    name: "high",
    maxFps: 90,
    pixelRatioCap: 0.7,
    maxRenderPixels: 960000,
    bloomDownscaleFactor: 0.8,
    enableBloom: true,
    enableGrain: true,
    showPanelGlow: true,
    showVertices: true,
    showRegionEffects: true,
    showBackdropArcs: true,
    starOpacity: 0.5,
    starCount: 5000,
  },
];
const ADAPTIVE_RENDER_SETTING_DEFINITIONS = [
  {
    key: "maxFps",
    label: "Target FPS",
    type: "integer",
    min: 1,
    max: 120,
    step: 2,
    format: (value) => `${value} FPS`,
    detail: "Frame cap for the scene update loop.",
  },
  {
    key: "pixelRatioCap",
    label: "Pixel Ratio Cap",
    type: "number",
    min: 0.1,
    max: 1,
    step: 0.05,
    precision: 2,
    format: (value) => `${value.toFixed(2)}x`,
    detail: "Upper bound for internal render resolution scaling.",
  },
  {
    key: "maxRenderPixels",
    label: "Pixel Budget",
    type: "integer",
    min: 200000,
    max: 1000000,
    step: 20000,
    format: (value) => `${Math.round(value / 1000)}K PX`,
    detail: "Viewport pixel budget before the scene scales down.",
  },
  {
    key: "bloomDownscaleFactor",
    label: "Bloom Scale",
    type: "number",
    min: 0.0,
    max: 1.0,
    step: 0.02,
    precision: 2,
    format: (value) => `${value.toFixed(2)}x`,
    detail: "Resolution factor used by the bloom pass.",
  },
  {
    key: "enableBloom",
    label: "Bloom Pass",
    type: "boolean",
    detail: "Enable or disable the bloom post-process pass.",
  },
  {
    key: "enableGrain",
    label: "Grain Pass",
    type: "boolean",
    detail: "Enable or disable the grain / fringe post-process pass.",
  },
  {
    key: "showPanelGlow",
    label: "Panel Glow",
    type: "boolean",
    detail: "Toggle additive glow planes on the station panels.",
  },
  {
    key: "showVertices",
    label: "Vertex Points",
    type: "boolean",
    detail: "Toggle point-cloud overlays on the station meshes.",
  },
  {
    key: "showRegionEffects",
    label: "Region Effects",
    type: "boolean",
    detail: "Toggle shader pulse and core effect meshes.",
  },
  {
    key: "showBackdropArcs",
    label: "Backdrop Arcs",
    type: "boolean",
    detail: "Toggle the large torus arc meshes behind the station.",
  },
  {
    key: "starOpacity",
    label: "Star Opacity",
    type: "number",
    min: 0.0,
    max: 1,
    step: 0.04,
    precision: 2,
    format: (value) => value.toFixed(2),
    detail: "Opacity multiplier for the background starfield.",
  },
  {
    key: "starCount",
    label: "Star Count",
    type: "integer",
    min: 0,
    max: 10000,
    step: 200,
    format: (value) => `${value}`,
    detail: "Number of stars drawn from the shared star buffer.",
  },
];
const ADAPTIVE_RENDER_SETTINGS_BY_KEY = new Map(
  ADAPTIVE_RENDER_SETTING_DEFINITIONS.map((definition) => [
    definition.key,
    definition,
  ]),
);

export class SpaceStationScene {
  constructor(canvasContainer, options = {}) {
    this.container = canvasContainer;
    this.clock = new THREE.Timer();
    this.clock.connect(document);
    this.loader = new GLTFLoader();
    initializeTerminalRuntimeState(this, options);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x01050a);
    this.scene.fog = new THREE.FogExp2(0x020812, 0.009);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1600,
    );
    this.camera.position.set(0, 2, 24);
    this.cameraBasePosition = new THREE.Vector3(0, 2, 24);
    this.cameraTarget = new THREE.Vector3();
    this.cameraLookAt = new THREE.Vector3();
    this.cameraOffset = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
      stencil: false,
    });
    this.qualityProfileIndex = this.getInitialQualityProfileIndex();
    this.activeQualityProfile = QUALITY_PROFILES[this.qualityProfileIndex];
    this.appliedQualityName = null;
    this.pixelRatio = this.computePixelRatio(this.activeQualityProfile);
    this.bloomDownscaleFactor = this.activeQualityProfile.bloomDownscaleFactor;
    this.maxFps = this.activeQualityProfile.maxFps;
    this.frameInterval = 1 / this.maxFps;
    this.accumulatedDt = 0;
    this.domUpdateInterval = 1 / 30;
    this.domAccumulatedDt = 0;
    this.performanceMonitor = {
      smoothedRenderCost: this.frameInterval * 0.5,
      evaluationTimer: 0,
      recoveryTimer: 0,
      switchCooldown: 0,
    };
    this.adaptiveQualityEditorSessions = 0;
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
      new THREE.Vector2(...this.getBloomRenderSize()),
      0.34,
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

    initializeStationVisualState(this);

    this.setupLighting();
    this.createBackground();
    this.createTelemetryHud();
    this.loadStationModel();
    this.setupEventListeners();
    this.applyQualityProfile(true);
    this.renderScene();
  }

  setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x182635, 0.72));
    this.scene.add(new THREE.HemisphereLight(0x80d8ff, 0x01050b, 0.86));

    this.keyLight = new THREE.DirectionalLight(0xa8e5ff, 1.9);
    this.keyLight.position.set(12, 14, 14);
    this.scene.add(this.keyLight);

    for (const [name, color, intensity, distance, pos] of [
      ["rimLight", 0x64dcff, 12, 120, [-10, 7, 16]],
      ["warmLight", 0xff955f, 8, 100, [-8, -4, -10]],
      ["fillLight", 0x6d8eff, 7, 90, [6, 3, -8]],
    ]) {
      const light = new THREE.PointLight(color, intensity, distance);
      light.position.set(...pos);
      this.scene.add((this[name] = light));
    }
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

      new THREE.Color()
        .setHSL(0.56 + Math.random() * 0.08, 0.42, 0.72 + Math.random() * 0.16)
        .toArray(colors, i * 3);
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    this.starfield = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 1.45,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        fog: false,
      }),
    );
    this.starfield.frustumCulled = false;
    this.scene.add(this.starfield);

    this.backdropArcs = new THREE.Group();
    [32, 44, 58].forEach((radius, index) => {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.15, 8, 48),
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

  getInitialQualityProfileIndex() {
    const viewportPixels = window.innerWidth * window.innerHeight;

    if (viewportPixels > 3000000) return 0;
    if (viewportPixels > 1500000) return 1;
    return 2;
  }

  computePixelRatio(profile = this.activeQualityProfile) {
    const viewportPixels = Math.max(1, window.innerWidth * window.innerHeight);
    const deviceRatio = Math.min(window.devicePixelRatio || 1, 1);
    const budgetScale = Math.sqrt(profile.maxRenderPixels / viewportPixels);

    return THREE.MathUtils.clamp(
      Math.min(deviceRatio, profile.pixelRatioCap, budgetScale),
      0.32,
      profile.pixelRatioCap,
    );
  }

  getBloomRenderSize() {
    return [
      Math.max(
        1,
        Math.round(
          window.innerWidth * this.pixelRatio * this.bloomDownscaleFactor,
        ),
      ),
      Math.max(
        1,
        Math.round(
          window.innerHeight * this.pixelRatio * this.bloomDownscaleFactor,
        ),
      ),
    ];
  }

  applyRenderResolution() {
    this.pixelRatio = this.computePixelRatio(this.activeQualityProfile);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.composer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloomPass.setSize(...this.getBloomRenderSize());
  }

  setCollectionVisibility(items, isVisible) {
    items.forEach((item) => {
      const target = item?.mesh || item;
      if (target) target.visible = isVisible;
    });
  }

  applyQualityProfile(force = false) {
    const profile = QUALITY_PROFILES[this.qualityProfileIndex];
    if (!force && this.appliedQualityName === profile.name) return;

    this.activeQualityProfile = profile;
    this.appliedQualityName = profile.name;
    this.bloomDownscaleFactor = profile.bloomDownscaleFactor;
    this.maxFps = profile.maxFps;
    this.frameInterval = 1 / this.maxFps;

    if (this.renderer && this.composer && this.bloomPass) {
      this.applyRenderResolution();
    }

    if (this.starfield) {
      this.starfield.material.opacity = profile.starOpacity;
      this.starfield.geometry.setDrawRange(0, profile.starCount);
    }

    if (this.backdropArcs) {
      this.backdropArcs.visible = profile.showBackdropArcs;
    }

    this.stationRegionList.forEach((region) => {
      this.setCollectionVisibility(region.vertices, profile.showVertices);
      this.setCollectionVisibility(region.effects, profile.showRegionEffects);
    });
    this.panelEntries.forEach((entry) => {
      entry.frontMesh.visible = profile.showPanelGlow;
      entry.backMesh.visible = profile.showPanelGlow;
    });
  }

  getCurrentQualityProfile() {
    return QUALITY_PROFILES[this.qualityProfileIndex];
  }

  beginAdaptiveRenderEditing() {
    this.adaptiveQualityEditorSessions += 1;
  }

  endAdaptiveRenderEditing() {
    this.adaptiveQualityEditorSessions = Math.max(
      0,
      this.adaptiveQualityEditorSessions - 1,
    );
  }

  formatAdaptiveRenderSettingValue(definition, value) {
    if (typeof definition.format === "function") {
      return definition.format(value);
    }

    if (definition.type === "boolean") {
      return value ? "ON" : "OFF";
    }

    return String(value);
  }

  getAdaptiveRenderEditorSnapshot() {
    const profile = this.getCurrentQualityProfile();
    const renderWidth = Math.max(
      1,
      Math.round(window.innerWidth * this.pixelRatio),
    );
    const renderHeight = Math.max(
      1,
      Math.round(window.innerHeight * this.pixelRatio),
    );
    const renderCostMs = this.performanceMonitor.smoothedRenderCost * 1000;
    const activePasses = [
      this.bloomPass.enabled ? "BLOOM" : null,
      this.grainPass.enabled ? "GRAIN" : null,
    ].filter(Boolean);

    return {
      profileName: profile.name.toUpperCase(),
      runtimeLines: [
        `PROFILE ${profile.name.toUpperCase()}  FPS ${this.maxFps.toString().padStart(2, "0")}  RES ${this.pixelRatio.toFixed(2)}x`,
        `FRAME ${renderCostMs.toFixed(2).padStart(6, " ")} MS  SIZE ${renderWidth}x${renderHeight}`,
        `PASSES ${(activePasses.join(" + ") || "RAW").padEnd(13, " ")}  AUTO ${this.adaptiveQualityEditorSessions > 0 ? "PAUSED" : "LIVE"}`,
      ],
      controls: ADAPTIVE_RENDER_SETTING_DEFINITIONS.map((definition) => {
        const value = profile[definition.key];

        return {
          id: definition.key,
          label: definition.label,
          valueText: this.formatAdaptiveRenderSettingValue(definition, value),
          detail: definition.detail,
        };
      }),
    };
  }

  adjustAdaptiveRenderSetting(settingId, direction = 1) {
    const definition = ADAPTIVE_RENDER_SETTINGS_BY_KEY.get(settingId);
    if (!definition) return false;

    const profile = this.getCurrentQualityProfile();
    const currentValue = profile[definition.key];
    let nextValue = currentValue;

    if (definition.type === "boolean") {
      nextValue = !currentValue;
    } else {
      const stepDirection = Math.sign(direction) || 1;
      nextValue = currentValue + definition.step * stepDirection;
      if (definition.type === "integer") {
        nextValue = Math.round(nextValue);
      }
      if (Number.isFinite(definition.min)) {
        nextValue = Math.max(definition.min, nextValue);
      }
      if (Number.isFinite(definition.max)) {
        nextValue = Math.min(definition.max, nextValue);
      }
      if (Number.isFinite(definition.precision)) {
        nextValue = Number(nextValue.toFixed(definition.precision));
      }
    }

    if (nextValue === currentValue) return false;

    profile[definition.key] = nextValue;
    this.applyQualityProfile(true);
    return true;
  }

  updatePerformanceBudget(renderCost, dt) {
    const monitor = this.performanceMonitor;
    monitor.smoothedRenderCost = THREE.MathUtils.lerp(
      monitor.smoothedRenderCost,
      renderCost,
      0.12,
    );
    monitor.evaluationTimer += dt;
    monitor.switchCooldown = Math.max(0, monitor.switchCooldown - dt);

    const upgradeThreshold = this.frameInterval * 0.45;
    if (monitor.smoothedRenderCost < upgradeThreshold) {
      monitor.recoveryTimer += dt;
    } else {
      monitor.recoveryTimer = 0;
    }

    if (this.adaptiveQualityEditorSessions > 0) {
      monitor.evaluationTimer = 0;
      monitor.recoveryTimer = 0;
      return;
    }

    if (monitor.evaluationTimer < 1.5 || monitor.switchCooldown > 0) return;
    monitor.evaluationTimer = 0;

    const overloaded = monitor.smoothedRenderCost > this.frameInterval * 0.9;
    if (overloaded && this.qualityProfileIndex > 0) {
      this.qualityProfileIndex -= 1;
      monitor.recoveryTimer = 0;
      monitor.switchCooldown = 2.5;
      this.applyQualityProfile();
      return;
    }

    if (
      monitor.recoveryTimer >= 6 &&
      this.qualityProfileIndex < QUALITY_PROFILES.length - 1
    ) {
      this.qualityProfileIndex += 1;
      monitor.recoveryTimer = 0;
      monitor.switchCooldown = 4;
      this.applyQualityProfile();
    }
  }

  renderScene() {
    if (this.bloomPass.enabled || this.grainPass.enabled) {
      this.composer.render();
      return;
    }

    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.applyQualityProfile(true);
  }

  updatePostProcessing(time) {
    const qualityProfile = this.activeQualityProfile;
    const bloomActive =
      qualityProfile.enableBloom &&
      (events.state.energy > 0.05 ||
        events.state.pulse > 0.04 ||
        events.state.shimmer > 0.04);
    const grainActive =
      qualityProfile.enableGrain &&
      (events.state.energy > 0.03 ||
        events.state.fringe > 0.01 ||
        events.state.distortion > 0.01);

    this.bloomPass.enabled = bloomActive;
    this.grainPass.enabled = grainActive;

    if (bloomActive) {
      this.bloomPass.strength =
        0.42 + events.state.pulse * 0.24 + events.state.shimmer * 0.2;
      this.bloomPass.radius = 0.42 + events.state.centroid * 0.16;
    }

    this.renderer.toneMappingExposure =
      0.98 + events.state.energy * 0.12 + events.state.rms * 0.08;

    if (grainActive) {
      this.grainPass.uniforms.u_time.value = time;
      this.grainPass.uniforms.u_strength.value =
        0.022 + events.state.energy * 0.014;
      this.grainPass.uniforms.u_scanline.value =
        0.05 + events.state.shimmer * 0.05;
      this.grainPass.uniforms.u_fringe.value =
        events.state.fringe * 0.24 + events.state.distortion * 0.14;
    }

    this.rimLight.intensity = 10 + events.state.pulse * 4;
    this.warmLight.intensity = 7 + events.state.bass_hit * 4.2;
    this.fillLight.intensity = 6 + events.state.centroid * 2.4;
  }

  update() {
    this.clock.update();
    const dt = this.clock.getDelta();
    this.accumulatedDt += dt;
    if (this.accumulatedDt < this.frameInterval) return;

    const frameDt = this.frameInterval;
    this.accumulatedDt %= this.frameInterval;
    const time = this.clock.getElapsed();

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

    const renderStart = performance.now();
    this.renderScene();
    this.updatePerformanceBudget(
      (performance.now() - renderStart) / 1000,
      frameDt,
    );
  }
}

attachStationVisualMethods(SpaceStationScene);
attachTerminalRuntimeMethods(SpaceStationScene);
