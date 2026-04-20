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

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const MODEL_TARGET_LENGTH = 10;

const CYAN = new THREE.Color(0x7ae7ff);
const BLUE = new THREE.Color(0x6fa0ff);
const PINK = new THREE.Color(0xff7ee1);
const ORANGE = new THREE.Color(0xffa15c);

export class SpaceStationScene {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    this.clock = new THREE.Clock();
    this.loader = new GLTFLoader();
    this.telemetry = {
      title: 'Signal telemetry',
      status: 'STANDBY',
      lines: [],
    };

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
    });
    this.pixelRatio = Math.min(window.devicePixelRatio, 1);
    this.bloomDownscaleFactor = 0.75;
    this.maxFps = 60;
    this.frameInterval = 1 / this.maxFps;
    this.accumulatedDt = 0;
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
      0.62,
      0.55,
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

    this.sharedPanelMaterial = new THREE.MeshBasicMaterial({
      color: 0x010101,
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
    };
    this.renderTelemetryHud();
  }

  setTelemetryVisible(isVisible) {
    if (!this.telemetryRoot) return;
    this.telemetryRoot.classList.toggle('visible', isVisible);
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

    this.stationModel.traverse((child) => {
      if (!child.isMesh) return;

      const geometry = child.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();

      const localSize = geometry.boundingBox.getSize(new THREE.Vector3());
      const scaledSize = new THREE.Box3().setFromObject(child).getSize(new THREE.Vector3());
      const isPanel = this.isPanelMesh(scaledSize);

      const material = isPanel ? this.sharedPanelMaterial : this.sharedInvisibleMaterial;
      child.material = Array.isArray(child.material) ? child.material.map(() => material) : material;
      child.renderOrder = isPanel ? 2 : 1;

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

      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wireMaterial);
      wire.renderOrder = 4;
      child.add(wire);

      if (isPanel) {
        this.panelEntries.push(this.createPanelOverlay(child, localSize));
      } else if (wireMaterial === this.wireMaterials.core) {
        this.coreWires.push(wire);
        this.coreVertices.push(this.createVertexLayer(child, this.vertexMaterials.core));
        this.createAttachedEffect(child, localSize, 'core');
      } else if (wireMaterial === this.wireMaterials.fore) {
        this.foreWires.push(wire);
        this.foreVertices.push(this.createVertexLayer(child, this.vertexMaterials.fore));
        this.createAttachedEffect(child, localSize, 'fore');
      } else if (wireMaterial === this.wireMaterials.aft) {
        this.aftWires.push(wire);
        this.aftVertices.push(this.createVertexLayer(child, this.vertexMaterials.aft));
        this.createAttachedEffect(child, localSize, 'aft');
      } else {
        this.bodyWires.push(wire);
        this.bodyVertices.push(this.createVertexLayer(child, this.vertexMaterials.body));
      }
    });
  }

  createVertexLayer(mesh, material) {
    const vertices = new THREE.Points(mesh.geometry, material);
    vertices.renderOrder = 6;
    mesh.add(vertices);
    return vertices;
  }

  createAttachedEffect(mesh, localSize, region) {
    const size = Math.max(localSize.x, localSize.y, localSize.z);
    if (size < 0.35) return;

    const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
    let effect;

    if (region === 'core') {
      effect = new THREE.Mesh(
        new THREE.IcosahedronGeometry(Math.max(0.04, size * 0.12), 0),
        new THREE.MeshBasicMaterial({ color: 0xff90e8, transparent: true, opacity: 0.22, toneMapped: false }),
      );
      this.coreEffects.push(effect);
    } else if (region === 'fore') {
      effect = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(0.06, size * 0.18), Math.max(0.01, size * 0.035), 8, 24),
        new THREE.MeshBasicMaterial({ color: 0x8de5ff, transparent: true, opacity: 0.16, toneMapped: false }),
      );
      this.foreEffects.push(effect);
    } else {
      effect = new THREE.Mesh(
        new THREE.OctahedronGeometry(Math.max(0.05, size * 0.14), 0),
        new THREE.MeshBasicMaterial({ color: 0xffa160, transparent: true, opacity: 0.2, toneMapped: false }),
      );
      this.aftEffects.push(effect);
    }

    effect.position.copy(center);
    effect.renderOrder = 7;
    mesh.add(effect);
  }

  createPanelOverlay(mesh, localSize) {
    const dims = [localSize.x, localSize.y, localSize.z];
    const thicknessAxis = dims.indexOf(Math.min(...dims));
    const planeAxes = [0, 1, 2].filter((axis) => axis !== thicknessAxis);
    const width = dims[planeAxes[0]] * 1.02;
    const height = dims[planeAxes[1]] * 1.02;
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
    const offset = Math.max(0.015, dims[thicknessAxis] * 0.9);

    if (thicknessAxis === 0) plane.rotation.y = Math.PI / 2;
    if (thicknessAxis === 1) plane.rotation.x = -Math.PI / 2;

    plane.position.set(
      thicknessAxis === 0 ? offset : 0,
      thicknessAxis === 1 ? offset : 0,
      thicknessAxis === 2 ? offset : 0,
    );
    plane.renderOrder = 5;
    mesh.add(plane);

    const planeBack = plane.clone();
    planeBack.material = glowMaterial.clone();
    planeBack.position.multiplyScalar(-1);
    planeBack.renderOrder = 5;
    mesh.add(planeBack);

    return {
      mesh,
      frontMaterial: glowMaterial,
      backMaterial: planeBack.material,
    };
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

  updateCamera(time) {
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
      const scale = 1 + shimmer * 0.32 + centroid * 0.18;
      effect.scale.setScalar(scale);
      effect.material.opacity = 0.08 + shimmer * 0.24 + centroid * 0.12;
      effect.material.color.copy(CYAN).lerp(BLUE, centroid * 0.24);
      effect.rotation.z = -time * (0.8 + index * 0.03);
    });

    this.aftEffects.forEach((effect, index) => {
      const scale = 1 + bassHit * 0.55 + pulse * 0.16;
      effect.scale.setScalar(scale);
      effect.material.opacity = 0.1 + bassHit * 0.3 + pulse * 0.12;
      effect.material.color.copy(ORANGE).lerp(PINK, pulse * 0.16);
      effect.rotation.x = time * (0.65 + index * 0.02);
      effect.rotation.z = time * (0.45 + index * 0.03);
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
    if (!this.telemetryRoot) return;

    const xShift = (Math.sin(time * 2.4) * events.state.fringe * 10).toFixed(2);
    const yShift = (Math.cos(time * 1.7) * events.state.distortion * 6).toFixed(2);

    this.telemetryRoot.style.setProperty('--terminal-shift-x', `${xShift}px`);
    this.telemetryRoot.style.setProperty('--terminal-shift-y', `${yShift}px`);
    this.telemetryRoot.style.setProperty('--terminal-opacity', `${0.62 + events.state.energy * 0.2 + events.state.shimmer * 0.08}`);
    this.telemetryRoot.style.setProperty('--terminal-glow', `${0.24 + events.state.shimmer * 0.6 + events.state.fringe * 0.2}`);
    this.telemetryRoot.style.borderColor = `rgba(121, 235, 255, ${0.2 + events.state.energy * 0.26})`;
    this.telemetryStatus.style.color = events.state.bass_hit > 0.08 ? '#ff9f67' : '#ff7ee1';
  }

  update() {
    const dt = this.clock.getDelta();
    this.accumulatedDt += dt;
    if (this.accumulatedDt < this.frameInterval) return;

    const frameDt = this.frameInterval;
    this.accumulatedDt %= this.frameInterval;
    const time = this.clock.getElapsedTime();

    this.updateCamera(time);
    this.updateStationMotion(time, frameDt);
    this.updateStationStyling(time);
    this.updatePostProcessing(time);
    this.updateTelemetryHud(time);

    this.composer.render();
  }
}
