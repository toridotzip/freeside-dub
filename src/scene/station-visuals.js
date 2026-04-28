import * as THREE from 'three';
import { events } from '../events.js';
import { pulseShader } from '../shader/pulse.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const MODEL_TARGET_LENGTH = 10;

const CYAN = new THREE.Color(0x7ae7ff);
const BLUE = new THREE.Color(0x6fa0ff);
const PINK = new THREE.Color(0xff7ee1);
const ORANGE = new THREE.Color(0xffa15c);

const STATION_REGION_DEFINITIONS = [
  ['body', {
    wire: { color: 0x5dd7ff, opacity: 0.36 },
    vertex: { color: 0x88ecff, size: 0.055, opacity: 0.42 },
  }],
  ['core', {
    wire: { color: 0xff89e2, opacity: 0.52 },
    vertex: { color: 0xff97e6, size: 0.065, opacity: 0.64 },
    effectType: 'core',
  }],
  ['fore', {
    wire: { color: 0x89d8ff, opacity: 0.45 },
    vertex: { color: 0x9ce4ff, size: 0.06, opacity: 0.54 },
    effectType: 'pulse',
    effectColor: 0x72b8ff,
  }],
  ['aft', {
    wire: { color: 0xffa76f, opacity: 0.52 },
    vertex: { color: 0xffb07a, size: 0.06, opacity: 0.6 },
    effectType: 'pulse',
    effectColor: 0xffa15c,
  }],
];

function createLineMaterial({ color, opacity }) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false });
}

function createPointsMaterial({ color, size, opacity }) {
  return new THREE.PointsMaterial({ color, size, transparent: true, opacity, toneMapped: false });
}

function createStationRegions() {
  return Object.fromEntries(STATION_REGION_DEFINITIONS.map(([key, definition]) => [
    key,
    {
      ...definition,
      wireMaterial: createLineMaterial(definition.wire),
      vertexMaterial: createPointsMaterial(definition.vertex),
      vertices: [],
      effects: [],
    },
  ]));
}

export function initializeStationVisualState(scene) {
  scene.stationAxis = new THREE.Vector3(1, 0, 0);
  scene.stationPlaneU = new THREE.Vector3(0, 1, 0);
  scene.stationPlaneV = new THREE.Vector3(0, 0, 1);
  scene.stationSpinAngle = 0;

  scene.stationBounds = new THREE.Vector3(8, 5, 6);
  scene.stationLength = MODEL_TARGET_LENGTH;
  scene.stationRadius = 4.2;
  scene.baseModelScale = 1;
  scene.stationModel = null;

  scene.sharedStationHullMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: true,
    depthTest: true,
  });
  scene.sharedPanelMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  scene.sharedInvisibleMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    toneMapped: false,
    depthWrite: false,
    depthTest: true,
  });
  scene.sharedInvisibleMaterial.colorWrite = false;
  scene.panelWireMaterial = createLineMaterial({ color: 0x7ae7ff, opacity: 0.48 });
  scene.stationRegions = createStationRegions();
  scene.panelEntries = [];

  scene.tempBox = new THREE.Box3();
}

const stationVisualMethods = {
  loadStationModel() {
    this.loader.load(
      '/station.glb',
      (gltf) => this.setStationModel(gltf.scene),
      undefined,
      (error) => {
        console.error('Failed to load /station.glb', error);
      },
    );
  },

  setStationModel(model) {
    this.stationModelGroup.clear();
    this.panelEntries = [];
    Object.values(this.stationRegions).forEach((region) => {
      region.vertices = [];
      region.effects = [];
    });

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
    this.applyQualityProfile(true);
    this.fitCameraToStation();
  },

  isPanelMesh(scaledSize) {
    const sortedSize = [scaledSize.x, scaledSize.y, scaledSize.z].sort((a, b) => a - b);
    const minDim = sortedSize[0];
    const midDim = sortedSize[1];
    const maxDim = sortedSize[2];

    return maxDim > 3 && midDim / maxDim < 0.08 && minDim / maxDim < 0.02;
  },

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
  },

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

      const regionKey = this.getStationRegionKey(isPanel, axial);
      const region = this.stationRegions[regionKey];
      const wireMaterial = isPanel ? this.panelWireMaterial : region.wireMaterial;
      if (buildWireOverlay) {
        const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wireMaterial);
        wire.renderOrder = 4;
        child.add(wire);
      }

      this.createHullLayer(child, isPanel ? this.sharedPanelMaterial : this.sharedStationHullMaterial, isPanel ? 2 : 1);

      if (isPanel) {
        const panelCenter = geometry.boundingBox.getCenter(new THREE.Vector3());
        if (buildPanelGlow) {
          this.panelEntries.push(this.createPanelOverlay(child, panelCenter, localSize));
        }
      } else {
        if (buildVertexOverlay) {
          region.vertices.push(this.createVertexLayer(child, region.vertexMaterial));
        }
        if (buildRegionEffect) {
          this.createRegionEffect(child, localSize, regionKey);
        }
      }
    });
  },

  getStationRegionKey(isPanel, axial) {
    if (isPanel) return 'body';
    if (Math.abs(axial) < this.stationLength * 0.16) return 'core';
    return axial > 0 ? 'fore' : 'aft';
  },

  createVertexLayer(mesh, material) {
    const vertices = new THREE.Points(mesh.geometry, material);
    vertices.renderOrder = 6;
    mesh.add(vertices);
    return vertices;
  },

  createHullLayer(mesh, material, renderOrder) {
    const hull = new THREE.Mesh(mesh.geometry, material);
    hull.userData.stationOverlay = true;
    hull.renderOrder = renderOrder;
    hull.position.copy(mesh.position);
    hull.quaternion.copy(mesh.quaternion);
    hull.scale.copy(mesh.scale);
    mesh.parent?.add(hull);
    return hull;
  },

  createRegionEffect(mesh, localSize, regionKey) {
    const region = this.stationRegions[regionKey];
    if (!region?.effectType) return;

    const size = Math.max(localSize.x, localSize.y, localSize.z);
    if (size < 0.35) return;

    const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
    let effectMesh;
    let material;
    let baseColor = null;

    if (region.effectType === 'core') {
      material = new THREE.MeshBasicMaterial({
        color: 0xff90e8,
        transparent: true,
        opacity: 0.22,
        wireframe: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      effectMesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(Math.max(0.04, size * 0.12), 0),
        material,
      );
      effectMesh.renderOrder = 7;
    } else if (region.effectType === 'pulse') {
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
      baseColor = new THREE.Color(region.effectColor);
      material = new THREE.ShaderMaterial({
        uniforms: pulseShader.uniforms(baseColor, halfSize, fillAxis, stripeAxis),
        vertexShader: pulseShader.vertexShader,
        fragmentShader: pulseShader.fragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      effectMesh = new THREE.Mesh(mesh.geometry, material);
      effectMesh.renderOrder = 8;
    }

    if (!effectMesh || !material) return;

    effectMesh.position.copy(center);
    mesh.add(effectMesh);
    region.effects.push({
      mesh: effectMesh,
      material,
      baseColor,
    });
  },

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
      frontMesh: plane,
      backMesh: planeBack,
      frontMaterial: glowMaterial,
      backMaterial: planeBack.material,
    };
  },

  updateAxisBasis() {
    const reference = Math.abs(this.stationAxis.dot(WORLD_UP)) > 0.92 ? WORLD_RIGHT : WORLD_UP;
    this.stationPlaneU.crossVectors(reference, this.stationAxis).normalize();
    this.stationPlaneV.crossVectors(this.stationAxis, this.stationPlaneU).normalize();
  },

  fitCameraToStation() {
    const maxDimension = Math.max(this.stationBounds.x, this.stationBounds.y, this.stationBounds.z, 1);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (maxDimension * 0.5) / Math.tan(fov * 0.5);
    const framedDistance = distance * 1;

    this.cameraBasePosition.set(0, Math.max(1.8, this.stationBounds.y * 0.14), framedDistance);
    this.cameraTarget.set(0, 0, 0);
    this.camera.position.copy(this.cameraBasePosition);
    this.camera.lookAt(this.cameraTarget);
  },

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
  },

  applyReactiveMaterial(material, baseColor, opacity, ...lerps) {
    material.color.copy(baseColor);
    lerps.forEach(([color, amount]) => {
      material.color.lerp(color, amount);
    });
    material.opacity = opacity;
  },

  updateStationStyling(time) {
    const qualityProfile = this.activeQualityProfile;
    const { bands, bass_hit: bassHit, pulse, shimmer, sweep, centroid } = events.state;
    const bodyRegion = this.stationRegions.body;
    const coreRegion = this.stationRegions.core;
    const foreRegion = this.stationRegions.fore;
    const aftRegion = this.stationRegions.aft;

    this.applyReactiveMaterial(this.panelWireMaterial, CYAN, 0.38 + bands.lowmid * 0.22 + shimmer * 0.12, [BLUE, bands.lowmid * 0.3], [PINK, shimmer * 0.14]);
    this.applyReactiveMaterial(bodyRegion.wireMaterial, CYAN, 0.24 + pulse * 0.16, [BLUE, sweep * 0.18]);
    this.applyReactiveMaterial(coreRegion.wireMaterial, PINK, 0.34 + bands.mid * 0.32 + sweep * 0.12, [CYAN, sweep * 0.24]);
    this.applyReactiveMaterial(foreRegion.wireMaterial, CYAN, 0.28 + shimmer * 0.24 + centroid * 0.12, [BLUE, centroid * 0.24]);
    this.applyReactiveMaterial(aftRegion.wireMaterial, ORANGE, 0.34 + bassHit * 0.28 + pulse * 0.12, [PINK, bassHit * 0.12]);
    this.applyReactiveMaterial(bodyRegion.vertexMaterial, CYAN, 0.28 + pulse * 0.18, [BLUE, sweep * 0.18]);
    this.applyReactiveMaterial(coreRegion.vertexMaterial, PINK, 0.46 + bands.mid * 0.24 + sweep * 0.14, [CYAN, sweep * 0.2]);
    this.applyReactiveMaterial(foreRegion.vertexMaterial, CYAN, 0.36 + shimmer * 0.22 + centroid * 0.1, [BLUE, centroid * 0.2]);
    this.applyReactiveMaterial(aftRegion.vertexMaterial, ORANGE, 0.4 + bassHit * 0.22 + pulse * 0.1, [PINK, pulse * 0.12]);

    if (qualityProfile.showPanelGlow) {
      this.panelEntries.forEach((entry, index) => {
        const intensity = bands.lowmid * 0.58 + shimmer * 0.42 + Math.sin(time * 1.3 + index * 0.7) * 0.04;
        const opacity = Math.max(0, intensity - 0.16) * 0.34;
        entry.frontMaterial.color.copy(CYAN).lerp(PINK, shimmer * 0.18);
        entry.backMaterial.color.copy(CYAN).lerp(BLUE, bands.high * 0.2);
        entry.frontMaterial.opacity = opacity;
        entry.backMaterial.opacity = opacity * 0.82;
      });
    }

    if (qualityProfile.showRegionEffects) {
      coreRegion.effects.forEach(({ mesh, material }, index) => {
        const scale = 1 + bands.mid * 0.5 + sweep * 0.18 + Math.sin(time * 1.8 + index) * 0.06;
        mesh.scale.setScalar(scale);
        material.opacity = 0.12 + bands.mid * 0.22 + sweep * 0.12;
        material.color.copy(PINK).lerp(CYAN, sweep * 0.22);
        mesh.rotation.x = time * (0.5 + index * 0.03);
        mesh.rotation.y = time * (0.8 + index * 0.04);
      });

      foreRegion.effects.forEach((effect, index) => {
        effect.material.uniforms.uRadius.value = THREE.MathUtils.clamp(0.16 + centroid * 0.34 + shimmer * 0.08, 0.12, 0.72);
        effect.material.uniforms.uOpacity.value = 0.18 + shimmer * 0.2 + centroid * 0.24;
        effect.material.uniforms.uPhase.value = time * 0.65 + index * 0.18;
        effect.material.uniforms.uColor.value.copy(effect.baseColor).lerp(CYAN, shimmer * 0.16);
      });

      aftRegion.effects.forEach((effect, index) => {
        effect.material.uniforms.uRadius.value = THREE.MathUtils.clamp(0.14 + bassHit * 0.3 + pulse * 0.14, 0.12, 0.68);
        effect.material.uniforms.uOpacity.value = 0.2 + bassHit * 0.22 + pulse * 0.16;
        effect.material.uniforms.uPhase.value = time * 0.52 + index * 0.16;
        effect.material.uniforms.uColor.value.copy(effect.baseColor).lerp(PINK, pulse * 0.12);
      });
    }

    this.starfield.rotation.y = time * 0.008;
    if (qualityProfile.showBackdropArcs) {
      this.backdropArcs.rotation.z = time * 0.016;
    }
  },
};

export function attachStationVisualMethods(SceneClass) {
  Object.assign(SceneClass.prototype, stationVisualMethods);
}
