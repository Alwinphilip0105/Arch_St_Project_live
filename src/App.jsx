import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts';
import { burialData as localBurialData } from './burialData';
import { fetchSheetData } from './services/sheetsService';
import {
  initAuth,
  openLogin,
  getCurrentUser,
  isAdmin,
} from './services/authService';
import { deriveAgeCat } from './utils/deriveAgeCat';
import { clusterBurials, getLastClusterEpsilon } from './utils/dbscan';
import ConfidencePanel from './components/ConfidencePanel';
import ClusterAnalysis from './components/ClusterAnalysis';
import { scoreMatch, normalizeName } from './confidenceEngine';
import { namedPersonsData } from './namedPersonsData';
import aspLogo from './assets/arch-st-bones-logo.png';
import './App.css';

// ─── Color Maps ──────────────────────────────────────────────────────────────
const COLOR_MAPS = {
  sex: { Male: '#6baed6', Female: '#fd8d3c', Unknown: '#aaaaaa' },
  age: {
    Infant: '#f9d03f',
    Child: '#f4a235',
    Adolescent: '#e05c1e',
    Subadult: '#c0392b',
    Adult: '#5a7fc2',
    Unknown: '#aaaaaa',
    'Young Adult': '#5a7fc2',
    'Middle Adult': '#3a5fa0',
    'Old Adult': '#1a3f80',
  },
  ancestry: {
    European: '#c97b3a', African: '#4aaf50',
    Admixed: '#e68a00', Indeterminate: '#8e66b5', Unknown: '#aaaaaa'
  },
  preservation: {
    Intact: '#2a9d8f', Partial: '#e9c46a', Destroyed: '#e76f51', Unknown: '#aaaaaa'
  }
};

const AGE_OPTIONS = [
  { key: 'Infant', label: 'Infant', type: 'age', indent: 0 },
  { key: 'Subadult', label: 'Subadult', type: 'age', indent: 0 },
  { key: 'Child', label: 'Child', type: 'ageCat', indent: 1, parent: 'Subadult' },
  { key: 'Adolescent', label: 'Adolescent', type: 'ageCat', indent: 1, parent: 'Subadult' },
  { key: 'Adult', label: 'Adult', type: 'age', indent: 0 },
  { key: 'Young Adult', label: 'Young Adult', type: 'ageCat', indent: 1, parent: 'Adult' },
  { key: 'Middle Adult', label: 'Middle Adult', type: 'ageCat', indent: 1, parent: 'Adult' },
  { key: 'Old Adult', label: 'Old Adult', type: 'ageCat', indent: 1, parent: 'Adult' },
  { key: 'Unknown', label: 'Unknown', type: 'age', indent: 0 },
];
const PRESERVATION_OPTIONS = ["Intact", "Partial", "Destroyed", "Unknown"];
const ANCESTRY_OPTIONS = ["European", "African", "Admixed", "Indeterminate", "Unknown"];
const ARTIFACT_OPTIONS = {
  Pin: "pin",
  Comb: "comb",
  Button: "button",
  Shroud: "shroud",
  "Shroud Decoration": "shroud decoration",
  Coin: "coin",
  "Personal Item": "personal",
  Industrial: "industrial",
  Funerary: "funerary",
};
const MATERIAL_OPTIONS = {
  Metal: "metal",
  Bone: "bone",
  Wood: "wood",
  "Plant Seed": "plant seed",
  Shell: "shell",
  Ceramic: "ceramic",
  Leather: "leather",
  Stone: "stone",
};

const COLOR_BY_OPTIONS = [
  { key: "sex", label: "Sex" },
  { key: "age", label: "Age" },
  { key: "ancestry", label: "Ancestry" },
  { key: "preservation", label: "Preservation" },
  { key: "clusters", label: "Clusters" },
];

const EMPTY_FILTERS = {
  sex: new Set(),
  age: new Set(),
  preservation: new Set(),
  knownOnly: false,
  ancestry: new Set(),
  artifactType: new Set(),
  materialType: new Set(),
};

// ─── Stats computations ───────────────────────────────────────────────────────
function computeStats(data) {
  const count = (key) => data.reduce((acc, d) => {
    const v = d[key] || 'Unknown';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});

  return {
    total: data.length,
    sex: count('sex'),
    age: count('age'),
    preservation: count('preservation'),
    ancestry: count('ancestry'),
    withArtifacts: data.filter(d => d.artifactType).length,
    knownPersons: data.filter(d => d.nameId).length,
    withSoftTissue: data.filter(d => d.softTissue).length,
    avgDepth: (data.reduce((a, d) => a + d.depth, 0) / data.length).toFixed(2),
  };
}

function toChartData(obj, colorMap) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, fill: colorMap?.[name] || '#888' }));
}

// ─── Three.js Scatter Component ───────────────────────────────────────────────
function ThreeScatter({
  data,
  colorBy,
  clusteredData,
  filters,
  onSelect,
  selected,
  theme,
  showSurface = true,
  highlightCluster,
  isClusterView = false,
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const colorByRef = useRef(colorBy);
  colorByRef.current = colorBy;
  const highlightClusterRef = useRef(highlightCluster);
  highlightClusterRef.current = highlightCluster;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const E_MIN = 370, E_MAX = 494, E_RANGE = 124, E_MID = 432;
  const N_MIN = 303, N_MAX = 421, N_RANGE = 118, N_MID = 362;
  const DEPTH_MAX = 20;
  const Z_SCALE = 3;

  function createTextSprite(text, fontSize = 36, color = '#2c2c2c', scale = 18) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Sprite();
    ctx.font = `bold ${fontSize}px "Open Sans", system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale, scale * 0.25, 1);
    return sprite;
  }

  function disposeObject3D(obj) {
    if (!obj) return;
    if (obj.geometry) obj.geometry.dispose?.();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material.dispose?.();
    }
    if (obj.material?.map) obj.material.map.dispose?.();
  }

  const buildSceneDecorations = useCallback((scene, currentTheme) => {
    const decorations = [];
    const LC = currentTheme === 'dark' ? '#c8b890' : '#2c2c2c';

    const terrainGeo = new THREE.PlaneGeometry(E_RANGE, N_RANGE);
    const terrainMat = new THREE.MeshLambertMaterial({
      color: 0x5a9234,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7
    });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.set(E_MID, 0, -N_MID);
    terrain.visible = showSurface;
    scene.add(terrain);
    decorations.push(terrain);

    const axMat = new THREE.LineBasicMaterial({ color: 0x4a453f, linewidth: 2 });
    const axisGroup = new THREE.Group();
    axisGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(E_MIN, -DEPTH_MAX * Z_SCALE, -N_MIN),
        new THREE.Vector3(E_MAX, -DEPTH_MAX * Z_SCALE, -N_MIN)
      ]),
      axMat.clone()
    ));
    axisGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(E_MIN, -DEPTH_MAX * Z_SCALE, -N_MIN),
        new THREE.Vector3(E_MIN, -DEPTH_MAX * Z_SCALE, -N_MAX)
      ]),
      axMat.clone()
    ));
    axisGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(E_MIN, -DEPTH_MAX * Z_SCALE, -N_MIN),
        new THREE.Vector3(E_MIN, 2, -N_MIN)
      ]),
      axMat.clone()
    ));
    scene.add(axisGroup);
    decorations.push(axisGroup);

    const labelGroup = new THREE.Group();
    [370, 432, 494].forEach((val) => {
      const s = createTextSprite(String(val), 36, LC, 16);
      s.position.set(val, -DEPTH_MAX * Z_SCALE, -N_MIN + 8);
      labelGroup.add(s);
    });
    const eT = createTextSprite('E (ft)', 36, LC, 22);
    eT.position.set(E_MID, -DEPTH_MAX * Z_SCALE - 6, -N_MIN + 15);
    labelGroup.add(eT);

    [303, 362, 421].forEach((val) => {
      const s = createTextSprite(String(val), 36, LC, 16);
      s.position.set(E_MIN - 8, -DEPTH_MAX * Z_SCALE, -val);
      labelGroup.add(s);
    });
    const nT = createTextSprite('N (ft)', 36, LC, 22);
    nT.position.set(E_MIN - 15, -DEPTH_MAX * Z_SCALE - 6, -N_MID);
    labelGroup.add(nT);

    [0, 5, 10, 15, 20].forEach((val) => {
      const s = createTextSprite(String(val), 36, LC, 16);
      s.position.set(E_MIN - 8, -val * Z_SCALE, -N_MIN + 6);
      labelGroup.add(s);
    });
    const dT = createTextSprite('Depth (ft)', 36, LC, 22);
    dT.position.set(E_MIN, 8, -N_MIN);
    labelGroup.add(dT);

    scene.add(labelGroup);
    decorations.push(labelGroup);

    const gridSize = Math.max(E_RANGE, N_RANGE);
    const gridMajor = currentTheme === 'dark' ? 0x999999 : 0x5f5a4d;
    const gridMinor = currentTheme === 'dark' ? 0xcccccc : 0x7a7464;
    const gridOpacity = currentTheme === 'dark' ? 0.3 : 0.5;
    const gridHelper = new THREE.GridHelper(gridSize, 4, gridMajor, gridMinor);
    gridHelper.position.set(E_MID, -DEPTH_MAX * Z_SCALE, -N_MID);
    if (Array.isArray(gridHelper.material)) {
      gridHelper.material.forEach((m) => {
        m.opacity = gridOpacity;
        m.transparent = true;
      });
    } else {
      gridHelper.material.opacity = gridOpacity;
      gridHelper.material.transparent = true;
    }
    scene.add(gridHelper);
    decorations.push(gridHelper);

    return { terrain, gridHelper, decorations };
  }, [showSurface]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const W = el.clientWidth;
    const H = el.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme === 'dark' ? 0x0d0b07 : 0xf0ede4);

    const tooltip = document.createElement('div');
    tooltip.className = 'burial-tooltip';
    tooltip.style.display = 'none';
    el.appendChild(tooltip);

    // Camera
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 2000);
    if (isClusterView) {
      camera.position.set(
        E_MID,
        N_RANGE * 2.2,
        -N_MID + N_RANGE * 1.4
      );
    } else {
      camera.position.set(
        E_MAX + E_RANGE * 0.8,
        N_RANGE * 0.8,
        -N_MIN + N_RANGE * 0.8
      );
    }
    const targetX = E_MID;
    const targetY = -DEPTH_MAX / 2 * Z_SCALE;
    const targetZ = -N_MID;
    camera.lookAt(targetX, targetY, targetZ);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.zoomSpeed = 1.2;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(targetX, targetY, targetZ);
    controls.update();

    // Ambient + directional light
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(E_MAX + 50, N_RANGE, -(N_MAX + 50));
    scene.add(dir);

    const { terrain, gridHelper, decorations } = buildSceneDecorations(scene, theme);

    function createCoffinGeometry() {
      const L = 4.5;
      const We = 0.9;
      const Wb = 2.3;
      const sh = L / 2 - L * 0.22;

      const shape = new THREE.Shape();
      shape.moveTo(-We / 2, L / 2);
      shape.lineTo(We / 2, L / 2);
      shape.lineTo(Wb / 2, sh);
      shape.lineTo(We / 2, -L / 2);
      shape.lineTo(-We / 2, -L / 2);
      shape.lineTo(-Wb / 2, sh);
      shape.closePath();

      return new THREE.ExtrudeGeometry(shape, {
        depth: 0.5,
        bevelEnabled: false,
      });
    }
    const coffinGeo = createCoffinGeometry();

    // Build markers
    const markers = [];
    const group = new THREE.Group();
    scene.add(group);

    data.forEach((d) => {
      const yPos = -d.depth * Z_SCALE;
      const colorHex =
        colorBy === 'clusters'
          ? d.clusterColor || '#666666'
          : COLOR_MAPS[colorBy]?.[d[colorBy]] || '#888888';
      const color = new THREE.Color(colorHex);
      const mat = new THREE.MeshPhongMaterial({
        color: color.clone(),
        emissive: color.clone(),
        emissiveIntensity: 0.2,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: colorBy === 'clusters' && d.isNoise ? 0.3 : 0.92,
      });
      const mesh = new THREE.Mesh(coffinGeo, mat.clone());

      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(d.e, yPos, -d.n);
      mesh.userData = { data: d };
      group.add(mesh);
      markers.push(mesh);
    });

    sceneRef.current = {
      scene,
      camera,
      renderer,
      controls,
      markers,
      group,
      terrain,
      gridHelper,
      decorations,
      selectedG: null,
    };

    // Raycaster for selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredMarker = null;

    function zoomToCoffin(marker, cam, orbit) {
      const target = marker.position.clone();
      orbit.target.copy(target);
      cam.position.set(target.x + 16, target.y + 14, target.z + 16);
      orbit.update();
    }

    function onMouseMove(e) {
      const rect = el.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / W) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / H) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(markers);
      el.style.cursor = hits.length ? 'pointer' : 'default';

      const skipHoverScale =
        colorByRef.current === 'clusters' && highlightClusterRef.current != null;

      if (!skipHoverScale) {
        if (hoveredMarker) {
          const dPrev = hoveredMarker.userData.data;
          const selG = sceneRef.current.selectedG;
          const bs = hoveredMarker.userData.baseScale ?? (hoveredMarker.visible ? 1 : 0);
          if (selG && dPrev.g === selG) hoveredMarker.scale.setScalar(2.2);
          else hoveredMarker.scale.setScalar(bs);
          hoveredMarker = null;
        }
        if (hits.length) {
          hoveredMarker = hits[0].object;
          const hm = hoveredMarker;
          const d = hm.userData.data;
          const selG = sceneRef.current.selectedG;
          const bs = hm.userData.baseScale ?? (hm.visible ? 1 : 0);
          if (selG && d.g === selG) hm.scale.setScalar(2.2);
          else hm.scale.setScalar(bs > 0 ? bs * 1.5 : 0);
        }
      }

      if (hits.length > 0 && hits[0].object.visible) {
        const d = hits[0].object.userData.data;
        const ageLabel = d.ageCat ? `${d.age} (${d.ageCat})` : d.age;
        const fmtNum = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? n.toFixed(2) : '—';
        };

        const cb = colorByRef.current;
        const clusterLine =
          cb === 'clusters'
            ? d.isNoise
              ? '<div class="tt-row tt-cluster">Spatial outlier (no cluster)</div>'
              : `<div class="tt-row tt-cluster">Cluster ${d.clusterId + 1}</div>`
            : '';

        tooltip.innerHTML = `
          <div class="tt-gnum">${d.g}${d.nameId ? '<span class="tt-name"> · ' + d.nameId + '</span>' : ''}</div>
          ${clusterLine}
          <div class="tt-row">N: ${fmtNum(d.n)} ft</div>
          <div class="tt-row">E: ${fmtNum(d.e)} ft</div>
          <div class="tt-row">Depth: ${fmtNum(d.depth)} ft</div>
          <div class="tt-row">Age: ${ageLabel || 'Unknown'}</div>
          <div class="tt-row">Sex: ${d.sex || 'Unknown'}</div>
          <div class="tt-row">Ancestry: ${d.ancestry || 'Unknown'}</div>
          ${d.artifactType ? '<div class="tt-row tt-artifact">Artifact: ' + d.artifactType + '</div>' : ''}
        `;
        tooltip.style.display = 'block';
        const maxLeft = el.clientWidth * 0.72;
        const leftPos = Math.min(e.clientX - rect.left + 14, maxLeft);
        tooltip.style.left = `${leftPos}px`;
        tooltip.style.top = `${e.clientY - rect.top - 10}px`;
      } else {
        tooltip.style.display = 'none';
      }
    }

    function onClick(e) {
      const rect = el.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / W) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / H) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(markers);

      if (hits.length > 0 && hits[0].object.visible) {
        const marker = hits[0].object;
        const burial = marker.userData.data;

        onSelectRef.current(burial);
        zoomToCoffin(marker, camera, controls);

        markers.forEach((m) => {
          m.material.emissiveIntensity = 0.1;
          m.scale.setScalar(1);
        });
        marker.material.emissiveIntensity = 0.8;
        marker.scale.setScalar(1.6);
      }
    }

    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onClick);

    // Resize handler
    function onResize() {
      const W2 = el.clientWidth, H2 = el.clientHeight;
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
      renderer.setSize(W2, H2);
    }
    window.addEventListener('resize', onResize);

    // Animate
    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.dispose();
      markers.forEach((m) => {
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose?.());
          else m.material.dispose?.();
        }
      });
      disposeObject3D(coffinGeo);
      decorations.forEach((obj) => {
        scene.remove(obj);
        disposeObject3D(obj);
      });
      if (el.contains(tooltip)) el.removeChild(tooltip);
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
    // Three.js scene initializes once on mount; markers/theme use dedicated effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update scene background when theme changes.
  useEffect(() => {
    const { scene, decorations = [], terrain } = sceneRef.current;
    if (!scene) return;
    scene.background.set(theme === 'dark' ? 0x0d0b07 : 0xf0ede4);
    decorations.forEach((obj) => {
      scene.remove(obj);
      disposeObject3D(obj);
    });
    const nextDecor = buildSceneDecorations(scene, theme);
    nextDecor.terrain.visible = terrain?.visible ?? showSurface;
    sceneRef.current.terrain = nextDecor.terrain;
    sceneRef.current.gridHelper = nextDecor.gridHelper;
    sceneRef.current.decorations = nextDecor.decorations;
  }, [buildSceneDecorations, theme, showSurface]);

  useEffect(() => {
    const { terrain } = sceneRef.current;
    if (!terrain) return;
    terrain.visible = showSurface;
  }, [showSurface]);

  useEffect(() => {
    const { markers } = sceneRef.current;
    if (!markers || !data?.length || markers.length !== data.length) return;
    data.forEach((d, i) => {
      markers[i].userData.data = d;
    });
  }, [data]);

  // Update colors when colorBy or clustered assignments change
  useEffect(() => {
    const { markers } = sceneRef.current;
    if (!markers) return;
    markers.forEach((m) => {
      const d = m.userData.data;
      let color;
      if (colorBy === 'clusters') {
        const clustered = clusteredData?.find((c) => c.g === d.g);
        color = new THREE.Color(clustered?.clusterColor || '#666666');
      } else {
        color = new THREE.Color(COLOR_MAPS[colorBy]?.[d[colorBy]] || '#888888');
      }
      m.material.color.set(color);
      m.material.emissive.set(color);
      m.material.transparent = true;
      m.material.opacity = 0.88;
      m.material.emissiveIntensity = 0.15;
      m.scale.setScalar(1);
      m.material.needsUpdate = true;
    });
  }, [colorBy, data, clusteredData]);

  // Visibility and single-burial selection
  useEffect(() => {
    const { markers } = sceneRef.current;
    if (!markers) return;
    sceneRef.current.selectedG = selected?.g ?? null;
    markers.forEach((m) => {
      const d = m.userData.data;
      const visible = passesFilters(d, filters);
      m.visible = visible;
      const noiseSmall = colorBy === 'clusters' && d.isNoise;
      const base = visible ? (noiseSmall ? 0.6 : 1) : 0;
      m.userData.baseScale = base;

      const isSel = selected && d.g === selected.g;
      if (isSel && visible) {
        m.scale.setScalar(2.2);
        m.material.emissiveIntensity = 0.6;
      } else {
        m.scale.setScalar(base);
        m.material.emissiveIntensity = 0.15;
      }
      if (colorBy === 'clusters' && d.isNoise) {
        m.material.opacity = 0.3;
      } else {
        m.material.opacity = 0.88;
      }
      m.material.needsUpdate = true;
    });
  }, [filters, colorBy, data, selected]);

  useEffect(() => {
    const { markers } = sceneRef.current;
    if (!markers?.length) return;
    if (colorBy !== 'clusters') return;

    markers.forEach((m) => {
      const d = m.userData.data;
      const cd = clusteredData?.find((x) => x.g === d.g);

      if (highlightCluster === null || highlightCluster === undefined) {
        const col = new THREE.Color(cd?.clusterColor || '#666666');
        m.material.color.set(col);
        m.material.emissive.set(col);
        m.material.emissiveIntensity = 0.18;
        m.material.opacity = 0.88;
        m.scale.setScalar(1.0);
        m.material.needsUpdate = true;
        return;
      }

      const inSelected = highlightCluster === -1
        ? cd?.isNoise === true
        : cd?.clusterId === highlightCluster;

      if (inSelected) {
        const col = new THREE.Color(cd?.clusterColor || '#c9940a');
        m.material.color.set(col);
        m.material.emissive.set(col);
        m.material.emissiveIntensity = 0.75;
        m.material.opacity = 1.0;
        m.scale.setScalar(1.5);
      } else {
        m.material.color.set(new THREE.Color(0x1e1e1e));
        m.material.emissive.set(new THREE.Color(0x000000));
        m.material.emissiveIntensity = 0.0;
        m.material.opacity = 0.12;
        m.scale.setScalar(0.85);
      }
      m.material.needsUpdate = true;
    });
  }, [highlightCluster, clusteredData, colorBy]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />;
}

function passesAgeFilter(d, ageSet) {
  if (ageSet.size === 0) return true;

  for (const key of ageSet) {
    const opt = AGE_OPTIONS.find((o) => o.key === key);
    if (!opt) continue;

    if (opt.type === 'age') {
      if (d.age === key) return true;
    }

    if (opt.type === 'ageCat') {
      if (d.age === opt.parent && d.ageCat === key) return true;
    }
  }
  return false;
}

function passesFilters(d, filters) {
  if (filters.sex.size > 0 && !filters.sex.has(d.sex)) return false;
  if (!passesAgeFilter(d, filters.age)) return false;
  if (filters.preservation.size > 0 && !filters.preservation.has(d.preservation)) return false;
  if (filters.ancestry.size > 0 && !filters.ancestry.has(d.ancestry)) return false;
  if (filters.artifactType.size > 0) {
    const artifactText = (d.artifactType || '').toLowerCase();
    const hasArtifactMatch = artifactText && Array.from(filters.artifactType).some((v) => artifactText.includes(v));
    if (!hasArtifactMatch) return false;
  }
  if (filters.materialType.size > 0) {
    const materialText = (d.materialType || '').toLowerCase();
    const hasMaterialMatch = materialText && Array.from(filters.materialType).some((v) => materialText.includes(v));
    if (!hasMaterialMatch) return false;
  }
  if (filters.knownOnly && !d.nameId) return false;
  return true;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const EDIT_FIELDS = [
  { key: 'depth', label: 'Depth (ft)', numeric: true },
  { key: 'n', label: 'North (ft)', numeric: true },
  { key: 'e', label: 'East (ft)', numeric: true },
  { key: 'age', label: 'Age' },
  { key: 'ageCat', label: 'Age Category' },
  { key: 'ageRange', label: 'Age Range' },
  { key: 'sex', label: 'Sex' },
  { key: 'sexMethod', label: 'Sexing Method' },
  { key: 'ancestry', label: 'Ancestry' },
  { key: 'preservation', label: 'Preservation' },
  { key: 'softTissue', label: 'Soft Tissue' },
  { key: 'coffinPreservation', label: 'Coffin Preservation' },
  { key: 'coffinShape', label: 'Coffin Shape' },
  { key: 'lidType', label: 'Lid Type' },
  { key: 'coffinLength', label: 'Length (cm)' },
  { key: 'coffinWidth', label: 'Width (cm)' },
  { key: 'coffinHandles', label: 'Handles' },
  { key: 'handleStyle', label: 'Handle Style' },
  { key: 'coffinPlates', label: 'Plates' },
  { key: 'artifactType', label: 'Artifact Type' },
  { key: 'materialType', label: 'Material' },
  { key: 'description', label: 'Description', textarea: true },
  { key: 'nameId', label: 'Name ID' },
  { key: 'dateOfDeath', label: 'Date of Death' },
];

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function DetailPanel({
  burial,
  onClose,
  editing,
  onCancelEdit,
  onSavePatch,
  clusteredData = [],
  onOpenClusterAnalysis,
}) {
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!editing || !burial) return;
    const next = {};
    EDIT_FIELDS.forEach(({ key }) => {
      const v = burial[key];
      next[key] = v === undefined || v === null ? '' : String(v);
    });
    setDraft(next);
  }, [editing, burial]);

  if (!burial) {
    return (
      <div className="detail-panel empty">
        <div className="detail-empty">
          <div className="detail-empty-inner">
            <span className="detail-empty-icon">⬡</span>
            <p className="detail-empty-title">No burial selected</p>
            <p className="detail-empty-hint">
              Click any coffin in the 3D view
              <br />
              or search a G-number above
              <br />
              to view its full record here
            </p>
          </div>
        </div>
      </div>
    );
  }

  const platesText = burial.coffinPlates || '';
  const hasAgeInscription = /aged\s+\d+/i.test(platesText);

  const rows = [
    ['G-Number', burial.g], ['Depth', burial.depth + ' ft'],
    ['North', burial.n + ' ft'], ['East', burial.e + ' ft'],
    ['—', null],
    ['Age', burial.age], ['Age Category', burial.ageCat || '—'],
    ['Age Range', burial.ageRange || '—'], ['Sex', burial.sex],
    ['Sexing Method', burial.sexMethod || '—'], ['Ancestry', burial.ancestry],
    ['—', null],
    ['Preservation', burial.preservation], ['Soft Tissue', burial.softTissue || '—'],
    ['—', null],
    ['Coffin Preservation', burial.coffinPreservation], ['Coffin Shape', burial.coffinShape],
    ['Lid Type', burial.lidType], ['Length (cm)', burial.coffinLength || '—'],
    ['Width (cm)', burial.coffinWidth || '—'], ['Handles', burial.coffinHandles],
    ['Handle Style', burial.handleStyle || '—'],
    ['—', null],
    ['Artifact Type', burial.artifactType || '—'], ['Material', burial.materialType || '—'],
    ['Description', burial.description || '—'],
    ['—', null],
    ['__plates__', null],
    ['—', null],
    ['Name ID', burial.nameId || '—'], ['Date of Death', burial.dateOfDeath || '—'],
  ];

  function handleSaveEdit() {
    if (!draft) return;
    const patch = {};
    EDIT_FIELDS.forEach(({ key, numeric }) => {
      const raw = draft[key];
      const prev = burial[key];
      const prevStr = prev === undefined || prev === null ? '' : String(prev);
      if (raw === prevStr) return;
      if (numeric) {
        const n = parseFloat(raw);
        patch[key] = Number.isFinite(n) ? n : prev;
      } else {
        patch[key] = raw;
      }
    });
    onSavePatch(patch);
  }

  const clusterRow =
    clusteredData.length > 0
      ? (() => {
          const c = clusteredData.find((x) => x.g === burial.g);
          if (!c || c.isNoise) {
            return (
              <div className="burial-cluster-tag outlier">
                Spatial outlier — no cluster
              </div>
            );
          }
          return (
            <div
              className="burial-cluster-tag"
              style={{ borderLeftColor: c.clusterColor }}
              onClick={() => onOpenClusterAnalysis?.(c.clusterId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenClusterAnalysis?.(c.clusterId);
                }
              }}
            >
              <span className="bct-dot" style={{ background: c.clusterColor }} />
              Cluster {c.clusterId + 1}
              <span className="bct-link">→ Analyse</span>
            </div>
          );
        })()
      : null;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className="detail-g">{burial.g}</span>
        <button className="detail-close" onClick={onClose} type="button">✕</button>
      </div>
      {clusterRow}
      {editing && draft ? (
        <div className="detail-edit-form">
          <p className="detail-edit-hint">Changes apply to this session (with local overrides until refresh).</p>
          <div className="detail-edit-actions">
            <button className="detail-edit-cancel" type="button" onClick={onCancelEdit}>
              Cancel
            </button>
            <button className="detail-edit-save" type="button" onClick={handleSaveEdit}>
              Save changes
            </button>
          </div>
          <div className="detail-rows detail-rows-edit">
            {EDIT_FIELDS.map(({ key, label, textarea }) => (
              <div key={key} className="detail-row detail-row-edit">
                <label className="detail-label" htmlFor={`edit-${key}`}>{label}</label>
                {textarea ? (
                  <textarea
                    id={`edit-${key}`}
                    className="detail-input detail-textarea"
                    value={draft[key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    rows={3}
                  />
                ) : (
                  <input
                    id={`edit-${key}`}
                    className="detail-input"
                    value={draft[key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="detail-rows">
          {rows.map(([label, val], i) => {
            if (label === '—') return <div key={i} className="detail-divider" />;
            if (label === '__plates__') {
              return (
                <React.Fragment key={i}>
                  <div className="detail-row">
                    <span className="detail-label">Plates</span>
                    <span
                      className={`detail-val${!platesText ? ' dim' : ''}${
                        hasAgeInscription ? ' inscription-highlight' : ''
                      }`}
                    >
                      {platesText || '—'}
                    </span>
                  </div>
                  {hasAgeInscription && (
                    <div className="inscription-note">
                      ⚑ Inscription contains age — may differ from coded estimate
                    </div>
                  )}
                </React.Fragment>
              );
            }
            return (
              <div key={i} className="detail-row">
                <span className="detail-label">{label}</span>
                <span className={`detail-val${!val || val === '—' ? ' dim' : ''}`}>{val || '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState('dark');
  const [showSurface, setShowSurface] = useState(true);
  const [colorBy, setColorBy] = useState('sex');
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState('scatter'); // 'scatter' | 'charts' | 'cluster'
  const [rightTab, setRightTab] = useState('record'); // 'record' | 'matches'
  const [isWideLayout, setIsWideLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1400 : true
  );
  const [searchVal, setSearchVal] = useState('');
  const [searchStatus, setSearchStatus] = useState(null); // null | 'found' | 'not_found'
  const [searchSuccessFlash, setSearchSuccessFlash] = useState(false);
  const [searchTopN, setSearchTopN] = useState(null);
  const [filters, setFilters] = useState({
    sex: new Set(),
    age: new Set(),
    preservation: new Set(),
    ancestry: new Set(),
    artifactType: new Set(),
    materialType: new Set(),
    knownOnly: false
  });
  const searchStatusTimeoutRef = useRef(null);
  const searchSuccessTimeoutRef = useRef(null);
  const [liveData, setLiveData] = useState(null);

  const [overrides, setOverrides] = useState({});
  const [currentUser, setCurrentUser] = useState(() => getCurrentUser());
  const [editing, setEditing] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState(null);
  /** 3D highlight driven only from Cluster Analysis tab / “View in 3D” — not coffin clicks */
  const [highlightCluster, setHighlightCluster] = useState(null);
  const [clusterSelectedBurial, setClusterSelectedBurial] = useState(null);

  const isEditor = currentUser !== null;
  const userIsAdmin = isAdmin(currentUser);

  const syncSheet = useCallback(async () => {
    try {
      const result = await fetchSheetData();

      if (result?.data?.length > 0) {
        setLiveData(result.data);
      } else {
        setLiveData(null);
      }
    } catch {
      setLiveData(null);
    }
  }, []);

  useEffect(() => {
    syncSheet();
  }, [syncSheet]);

  const baseData = Array.isArray(liveData) && liveData.length > 0 ? liveData : localBurialData;

  const enrichedData = useMemo(
    () =>
      baseData.map((d) => ({
        ...d,
        ageCat: deriveAgeCat(d),
      })),
    [baseData]
  );

  const mergedData = useMemo(
    () =>
      enrichedData.map((d) => (overrides[d.g] ? { ...d, ...overrides[d.g] } : d)),
    [enrichedData, overrides]
  );

  useEffect(() => {
    initAuth(
      (user) => setCurrentUser(user),
      () => {
        setCurrentUser(null);
        setEditing(false);
      }
    );
  }, []);

  useEffect(() => {
    setEditing(false);
  }, [selected?.g]);

  const handleScatterSelect = useCallback((burial) => {
    setHighlightCluster(null);
    setSelected(burial);
    setRightTab('record');
    setSearchTopN(null);
  }, []);

  const clearRecordSelection = useCallback(() => {
    setSelected(null);
    setHighlightCluster(null);
    setEditing(false);
  }, []);

  const openClusterAnalysis = useCallback((clusterId) => {
    setSelectedCluster(clusterId);
    setActiveTab('cluster');
  }, []);

  const [clusteredData, setClusteredData] = useState([]);
  const [clusteringDone, setClusteringDone] = useState(false);
  const [clusterEpsilonUsed, setClusterEpsilonUsed] = useState(null);

  useEffect(() => {
    if (!mergedData.length) {
      setClusteredData([]);
      setClusteringDone(false);
      setClusterEpsilonUsed(null);
      return;
    }
    setClusteringDone(false);
    const t = setTimeout(() => {
      const result = clusterBurials(mergedData, null, 2);
      setClusteredData(result);
      setClusterEpsilonUsed(getLastClusterEpsilon());
      setClusteringDone(true);
    }, 50);
    return () => clearTimeout(t);
  }, [mergedData]);

  useEffect(() => {
    if (colorBy !== 'clusters') setHighlightCluster(null);
  }, [colorBy]);

  useEffect(() => {
    setClusterSelectedBurial(null);
  }, [selectedCluster]);

  useEffect(() => {
    if (activeTab !== 'cluster') {
      setHighlightCluster(null);
    }
  }, [activeTab]);

  useEffect(() => {
    setSelected((sel) => {
      if (!sel?.g) return sel;
      const row = clusteredData.find((d) => d.g === sel.g);
      return row ?? sel;
    });
  }, [clusteredData]);

  const clusterPriors = useMemo(() => {
    if (!clusteredData.length) return {};

    const firstPass = {};
    clusteredData.forEach((burial) => {
      const results = scoreMatch(burial, namedPersonsData, null);
      if (results.length > 0) {
        firstPass[burial.g] = {
          clusterId: burial.clusterId,
          top1Name: results[0]?.person?.nameId || '',
          top1Conf: results[0]?.score || 0,
          top2Name: results[1]?.person?.nameId || '',
          top2Conf: results[1]?.score || 0,
          top3Name: results[2]?.person?.nameId || '',
          top3Conf: results[2]?.score || 0,
          knownName: burial.nameId || '',
        };
      }
    });

    const priors = {};
    Object.values(firstPass).forEach(
      ({ clusterId, top1Name, top1Conf, top2Name, top2Conf, top3Name, top3Conf, knownName }) => {
        if (clusterId === -1) return;
        if (!priors[clusterId]) priors[clusterId] = {};

        const add = (name, weight, includeLast = false, lastFactor = 0) => {
          if (!name) return;
          const key = normalizeName(name);
          priors[clusterId][key] = (priors[clusterId][key] || 0) + weight;
          if (includeLast) {
            const last = key.split(' ').at(-1);
            priors[clusterId][last] = (priors[clusterId][last] || 0) + weight * lastFactor;
          }
        };

        // Match notebook priors:
        // top1 contributes full-name and last-name, top2/top3 full-name only.
        add(top1Name, (top1Conf / 100) * 2.0, true, 0.4);
        add(top2Name, (top2Conf / 100) * 1.0);
        add(top3Name, (top3Conf / 100) * 0.5);
        add(knownName, 3.0);
      }
    );

    return priors;
  }, [clusteredData]);

  const clusterCount = useMemo(
    () => new Set(clusteredData.map((d) => d.clusterId).filter((id) => id !== -1)).size,
    [clusteredData]
  );

  const noiseCount = useMemo(
    () => clusteredData.filter((d) => d.isNoise).length,
    [clusteredData]
  );

  const clusterBarData = useMemo(() => {
    const acc = {};
    clusteredData.forEach((d) => {
      const k = d.isNoise ? 'Outliers' : `C${d.clusterId + 1}`;
      acc[k] = (acc[k] || 0) + 1;
    });
    return Object.entries(acc)
      .sort((a, b) => {
        if (a[0] === 'Outliers') return 1;
        if (b[0] === 'Outliers') return -1;
        return b[1] - a[1];
      })
      .map(([name, count]) => ({ name, count }));
  }, [clusteredData]);

  const stats = useMemo(() => computeStats(mergedData), [mergedData]);

  const filteredData = useMemo(
    () => mergedData.filter((d) => passesFilters(d, filters)),
    [filters, mergedData]
  );

  const visibleCount = filteredData.length;
  const matches = useMemo(() => {
    if (!selected) return [];
    return scoreMatch(selected, namedPersonsData, clusterPriors).filter(Boolean);
  }, [selected, clusterPriors]);

  const highCount = useMemo(
    () => matches.filter((m) => m.confidence === 'High').length,
    [matches]
  );
  const modCount = useMemo(
    () => matches.filter((m) => m.confidence === 'Moderate').length,
    [matches]
  );
  const anyCount = matches.length;

  useEffect(() => {
    function handleResize() {
      setIsWideLayout(window.innerWidth >= 1400);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    return () => {
      if (searchStatusTimeoutRef.current) {
        clearTimeout(searchStatusTimeoutRef.current);
      }
      if (searchSuccessTimeoutRef.current) {
        clearTimeout(searchSuccessTimeoutRef.current);
      }
    };
  }, []);

  function toggleFilter(dim, val) {
    setFilters(prev => {
      const next = new Set(prev[dim]);
      next.has(val) ? next.delete(val) : next.add(val);
      return { ...prev, [dim]: next };
    });
  }

  function toggleAgeFilter(key) {
    setFilters((prev) => {
      const next = new Set(prev.age);
      const opt = AGE_OPTIONS.find((o) => o.key === key);

      if (next.has(key)) {
        next.delete(key);
        if (opt?.type === 'age') {
          AGE_OPTIONS.filter((o) => o.parent === key).forEach((o) => next.delete(o.key));
        }
      } else {
        next.add(key);
      }
      return { ...prev, age: next };
    });
  }

  const ageCounts = useMemo(() => {
    const counts = {};
    AGE_OPTIONS.forEach((opt) => {
      counts[opt.key] = mergedData.filter((d) => {
        if (opt.type === 'age') return d.age === opt.key;
        if (opt.type === 'ageCat') return d.age === opt.parent && d.ageCat === opt.key;
        return false;
      }).length;
    });
    return counts;
  }, [mergedData]);

  function handleSearch(e) {
    if (e.key !== 'Enter') return;
    const raw = searchVal.trim().toUpperCase().replace(/^G-?/, '');
    const padded = raw.padStart(3, '0');

    const found = mergedData.find(
      (d) =>
        d.g.replace('G-', '') === raw ||
        d.g.replace('G-', '') === padded
    );

    if (searchStatusTimeoutRef.current) {
      clearTimeout(searchStatusTimeoutRef.current);
    }
    if (searchSuccessTimeoutRef.current) {
      clearTimeout(searchSuccessTimeoutRef.current);
    }

    if (found) {
      setHighlightCluster(null);
      setSelected(found);
      setSearchStatus('found');
      setActiveTab('scatter');
      setRightTab('matches');
      setSearchTopN(5);

      setSearchSuccessFlash(true);
      searchSuccessTimeoutRef.current = setTimeout(() => setSearchSuccessFlash(false), 1000);
    } else {
      setHighlightCluster(null);
      setSelected(null);
      setSearchStatus('not_found');
      setSearchSuccessFlash(false);
      setSearchTopN(null);
    }

    searchStatusTimeoutRef.current = setTimeout(() => setSearchStatus(null), 4000);
  }

  const sexData = toChartData(stats.sex, COLOR_MAPS.sex);
  const ageData = toChartData(stats.age, COLOR_MAPS.age);
  const presData = toChartData(stats.preservation, COLOR_MAPS.preservation);
  const ancData = toChartData(stats.ancestry, COLOR_MAPS.ancestry);

  // Depth histogram
  const depthBins = useMemo(() => {
    const bins = {};
    mergedData.forEach((d) => {
      const b = Math.floor(d.depth / 2) * 2;
      bins[b] = (bins[b] || 0) + 1;
    });
    return Object.entries(bins)
      .sort((a, b) => +a[0] - +b[0])
      .map(([depth, count]) => ({ depth: depth + '–' + (+depth + 2) + ' ft', count }));
  }, [mergedData]);

  return (
    <div className={`app theme-${theme}`}>
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <img src={aspLogo} alt="Arch Street Project" className="header-logo" />
          <div>
            <h1 className="header-title">Arch Street Burial Site</h1>
            <p className="header-sub">Philadelphia, PA · 18th–19th Century · 324 Burials Excavated</p>
          </div>
        </div>
        <div className="header-stats">
          <StatCard label="Total Burials" value={stats.total} />
          <StatCard label="Named Persons" value={stats.knownPersons} />
          <StatCard label="With Artifacts" value={stats.withArtifacts} />
          <StatCard label="Avg Depth" value={stats.avgDepth + ' ft'} />
          <StatCard label="Soft Tissue" value={stats.withSoftTissue} />
        </div>
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          type="button"
        >
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
      </header>

      {/* Tab bar */}
      <div className="tab-bar">
        <button className={`tab-btn ${activeTab === 'scatter' ? 'active' : ''}`}
          onClick={() => setActiveTab('scatter')}>3D Spatial View</button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'cluster' ? 'active' : ''}`}
          onClick={() => setActiveTab('cluster')}
        >
          Cluster Analysis
          {clusteringDone && (
            <span className="tab-badge">
              {new Set(clusteredData.filter((d) => !d.isNoise).map((d) => d.clusterId)).size}
            </span>
          )}
        </button>
        <button className={`tab-btn ${activeTab === 'charts' ? 'active' : ''}`}
          onClick={() => setActiveTab('charts')}>Analytics</button>
        <div className="tab-search">
          <div className="search-wrapper">
            <span className="search-label">BURIAL RECORD</span>
            <div className="search-input-wrap">
              <input
                className={`search-input${searchSuccessFlash ? ' search-success' : ''}`}
                placeholder="G-#"
                value={searchVal}
                onChange={e => setSearchVal(e.target.value)}
                onKeyDown={handleSearch}
              />
              {searchStatus === 'not_found' && (
                <div className="search-not-found">
                  <img src={aspLogo} alt="" className="header-logo-sm" />
                  No burial record found for "{searchVal}"
                </div>
              )}
            </div>
          </div>
          {selected && anyCount > 0 && (
            <span
              className={`search-badge match-badge ${highCount > 0 ? 'high' : modCount > 0 ? 'possible' : 'weak'}`}
            >
              {highCount > 0
                ? `${highCount} High match${highCount === 1 ? '' : 'es'}`
                : modCount > 0
                  ? `${modCount} Possible match${modCount === 1 ? '' : 'es'}`
                  : `${anyCount} Weak match${anyCount === 1 ? '' : 'es'}`}
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      {activeTab === 'scatter' && (
        <div className="scatter-layout">
          {/* Left sidebar: filters */}
          <aside className="sidebar">
            <div className="sidebar-section">
              <h3 className="sidebar-heading">Color By</h3>
              <div className="btn-group">
                {COLOR_BY_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    className={`pill-btn ${colorBy === key ? 'active' : ''}`}
                    onClick={() => setColorBy(key)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="sidebar-section">
              <h3 className="sidebar-heading">Filter: Sex</h3>
              {Object.keys(COLOR_MAPS.sex).map(v => (
                <label key={v} className="filter-check">
                  <input type="checkbox" checked={filters.sex.has(v)}
                    onChange={() => toggleFilter('sex', v)} />
                  <span className="filter-dot" style={{ background: COLOR_MAPS.sex[v] }} />
                  {v}
                </label>
              ))}
            </div>

            <div className="sidebar-section">
              <h3 className="sidebar-heading">Filter: Age</h3>
              {AGE_OPTIONS.map((opt) => {
                const zeroCount = ageCounts[opt.key] === 0;
                return (
                <label
                  key={opt.key}
                  className={`filter-check${opt.indent > 0 ? ' sub' : ''}${
                    zeroCount ? ' zero-count' : ''
                  }`}
                  title={
                    zeroCount ? 'No burials in this category in current dataset' : ''
                  }
                  style={{ paddingLeft: `${opt.indent * 16}px` }}
                >
                  <input
                    type="checkbox"
                    checked={filters.age.has(opt.key)}
                    onChange={() => toggleAgeFilter(opt.key)}
                  />
                  <span
                    className="filter-dot"
                    style={{ background: COLOR_MAPS.age[opt.key] || '#aaa' }}
                  />
                  {opt.label}
                  <span className="filter-count">({ageCounts[opt.key]})</span>
                </label>
                );
              })}
            </div>

            <div className="sidebar-section">
              <h3 className="sidebar-heading">Preservation State</h3>
              {PRESERVATION_OPTIONS.map(v => (
                <label key={v} className="filter-check">
                  <input type="checkbox" checked={filters.preservation.has(v)}
                    onChange={() => toggleFilter('preservation', v)} />
                  <span className="filter-dot" style={{ background: COLOR_MAPS.preservation[v] }} />
                  {v}
                </label>
              ))}
            </div>

            <div className="sidebar-section">
              <h3 className="sidebar-heading">Filter: Ancestry</h3>
              {ANCESTRY_OPTIONS.map(v => (
                <label key={v} className="filter-check">
                  <input type="checkbox" checked={filters.ancestry.has(v)}
                    onChange={() => toggleFilter('ancestry', v)} />
                  <span className="filter-dot" style={{ background: COLOR_MAPS.ancestry[v] || '#aaaaaa' }} />
                  {v}
                </label>
              ))}
            </div>

            <div className="sidebar-section">
              <h3 className="sidebar-heading">Filter: Artifact Type</h3>
              {Object.entries(ARTIFACT_OPTIONS).map(([label, value]) => (
                <label key={label} className="filter-check">
                  <input type="checkbox" checked={filters.artifactType.has(value)}
                    onChange={() => toggleFilter('artifactType', value)} />
                  <span className="filter-dot" style={{ background: '#8e66b5' }} />
                  {label}
                </label>
              ))}
            </div>

            <div className="sidebar-section">
              <h3 className="sidebar-heading">Filter: Artifact Composition</h3>
              {Object.entries(MATERIAL_OPTIONS).map(([label, value]) => (
                <label key={label} className="filter-check">
                  <input type="checkbox" checked={filters.materialType.has(value)}
                    onChange={() => toggleFilter('materialType', value)} />
                  <span className="filter-dot" style={{ background: '#c97b3a' }} />
                  {label}
                </label>
              ))}
            </div>

            <div className="sidebar-section">
              <h3 className="sidebar-heading">Known Persons</h3>
              <label className="filter-check">
                <input type="checkbox" checked={filters.knownOnly}
                  onChange={() => setFilters(p => ({ ...p, knownOnly: !p.knownOnly }))} />
                <span className="filter-dot" style={{ background: '#c9940a' }} />
                Known
              </label>
            </div>

            <div className="sidebar-count">
              <span className="count-num">{visibleCount}</span>
              <span className="count-label"> of {stats.total} graves</span>
            </div>

            {/* Legend / key (hidden in cluster mode to avoid clutter) */}
            {colorBy !== 'clusters' && (
              <div className="sidebar-section legend-section">
                <h3 className="sidebar-heading">
                  Legend — {COLOR_BY_OPTIONS.find((o) => o.key === colorBy)?.label || colorBy}
                </h3>
                {Object.entries(COLOR_MAPS[colorBy]).map(([k, c]) => (
                  <div key={k} className="legend-row">
                    <span className="filter-dot" style={{ background: c }} />
                    {k}
                  </div>
                ))}
              </div>
            )}
          </aside>

          {/* 3D Canvas */}
          <div className="canvas-area">
            {clusteredData.length > 0 ? (
              <ThreeScatter
                key="main-scatter"
                data={clusteredData}
                colorBy={colorBy}
                clusteredData={clusteredData}
                filters={filters}
                onSelect={handleScatterSelect}
                selected={selected}
                theme={theme}
                showSurface={showSurface}
                highlightCluster={
                  activeTab === 'scatter' && colorBy === 'clusters'
                    ? highlightCluster
                    : null
                }
              />
            ) : (
              <div className="canvas-scatter-placeholder" aria-live="polite">
                <span className="detail-icon">⬡</span>
                <p>
                  {mergedData.length === 0
                    ? 'Loading burial data…'
                    : 'Computing spatial clusters…'}
                </p>
              </div>
            )}
            <div className="scene-title">
              <h2>Spatial Distribution of Burial Features</h2>
              <p>Site area 124 × 118 ft — Depth 0 to 20 ft</p>
            </div>
            <div className="surface-toggle">
              <span>Ground Surface:</span>
              <button className={showSurface ? 'active' : ''} onClick={() => setShowSurface(true)}>
                On (Green)
              </button>
              <button className={!showSurface ? 'active' : ''} onClick={() => setShowSurface(false)}>
                Off
              </button>
            </div>
            {colorBy !== 'clusters' && (
              <div className="map-key-stack" aria-label="3D map key">
                <div className="map-key-card">
                  <div className="map-key-title">
                    {COLOR_BY_OPTIONS.find((o) => o.key === colorBy)?.label || colorBy}
                  </div>
                  {Object.entries(COLOR_MAPS[colorBy] || {}).map(([label, color]) => (
                    <div key={label} className="map-key-row">
                      <span className="map-key-dot" style={{ background: color }} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="canvas-hint">Drag to rotate · Scroll to zoom · Click to inspect</div>
          </div>

          {/* Right: stacked detail + confidence panels */}
          <div className={`right-column${selected ? ' has-selection' : ''}`}>
            {!isWideLayout && (
              <div className="right-column-tabs">
                <button
                  className={`right-tab-btn ${rightTab === 'record' ? 'active' : ''}`}
                  onClick={() => setRightTab('record')}
                >
                  Record
                </button>
                <button
                  className={`right-tab-btn ${rightTab === 'matches' ? 'active' : ''}`}
                  onClick={() => setRightTab('matches')}
                >
                  ID Matches
                </button>
              </div>
            )}

            {isWideLayout ? (
              <div className="right-tab-content right-tab-content-wide">
                <div className="right-panel-slot record-slot">
                  {selected && !editing && (
                    <button
                      className="edit-record-btn"
                      type="button"
                      onClick={() => {
                        if (userIsAdmin) {
                          setEditing(true);
                        } else if (isEditor) {
                          alert('You need admin role to edit records. Contact Alwin.');
                        } else {
                          openLogin();
                        }
                      }}
                    >
                      {isEditor
                        ? userIsAdmin
                          ? '✎ Edit Record'
                          : '🔒 View Only'
                        : '🔒 Sign In to Edit'}
                    </button>
                  )}
                  <DetailPanel
                    burial={selected}
                    onClose={clearRecordSelection}
                    editing={editing}
                    onCancelEdit={() => setEditing(false)}
                    onSavePatch={(patch) => {
                      if (!selected?.g) return;
                      setOverrides((prev) => ({
                        ...prev,
                        [selected.g]: { ...(prev[selected.g] || {}), ...patch },
                      }));
                      setEditing(false);
                    }}
                    clusteredData={clusteredData}
                    onOpenClusterAnalysis={openClusterAnalysis}
                  />
                </div>
                <div className="right-panel-slot matches-slot">
                  <ConfidencePanel
                    burial={selected}
                    clusterPriors={clusterPriors}
                    topN={searchTopN}
                    showComparisonTable={!!searchTopN}
                    onClose={clearRecordSelection}
                  />
                </div>
              </div>
            ) : (
              <div className="right-tab-content">
              <div className="right-panel-slot mobile-slot">
                {rightTab === 'record' ? (
                  <>
                    {selected && !editing && (
                      <button
                        className="edit-record-btn"
                        type="button"
                        onClick={() => {
                          if (userIsAdmin) {
                            setEditing(true);
                          } else if (isEditor) {
                            alert('You need admin role to edit records. Contact Alwin.');
                          } else {
                            openLogin();
                          }
                        }}
                      >
                        {isEditor
                          ? userIsAdmin
                            ? '✎ Edit Record'
                            : '🔒 View Only'
                          : '🔒 Sign In to Edit'}
                      </button>
                    )}
                    <DetailPanel
                      burial={selected}
                      onClose={clearRecordSelection}
                      editing={editing}
                      onCancelEdit={() => setEditing(false)}
                      onSavePatch={(patch) => {
                        if (!selected?.g) return;
                        setOverrides((prev) => ({
                          ...prev,
                          [selected.g]: { ...(prev[selected.g] || {}), ...patch },
                        }));
                        setEditing(false);
                      }}
                      clusteredData={clusteredData}
                      onOpenClusterAnalysis={openClusterAnalysis}
                    />
                  </>
                ) : (
                  <ConfidencePanel
                    burial={selected}
                    clusterPriors={clusterPriors}
                    topN={searchTopN}
                    showComparisonTable={!!searchTopN}
                    onClose={clearRecordSelection}
                  />
                )}
              </div>
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === 'charts' && (
        <div className="charts-layout">
          <div className="charts-grid">
            <div className="chart-card">
              <h3 className="chart-title">Sex Distribution</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={sexData} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" outerRadius={80} label={({name, percent}) =>
                      `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                    {sexData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [v, 'Count']} contentStyle={{ background: '#1a1610', border: '1px solid #3a3020', color: '#e8d9b0' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3 className="chart-title">Age Distribution</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ageData} margin={{ top: 5, right: 10, bottom: 40, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2418" />
                  <XAxis dataKey="name" tick={{ fill: '#a89870', fontSize: 11 }} angle={-35} textAnchor="end" />
                  <YAxis tick={{ fill: '#a89870', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#1a1610', border: '1px solid #3a3020', color: '#e8d9b0' }} />
                  <Bar dataKey="value" name="Count" radius={[3, 3, 0, 0]}>
                    {ageData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3 className="chart-title">Preservation State</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={presData} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={50} outerRadius={85}
                    label={({name, percent}) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                    {presData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1a1610', border: '1px solid #3a3020', color: '#e8d9b0' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3 className="chart-title">Ancestry</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ancData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2418" />
                  <XAxis type="number" tick={{ fill: '#a89870', fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: '#a89870', fontSize: 11 }} width={75} />
                  <Tooltip contentStyle={{ background: '#1a1610', border: '1px solid #3a3020', color: '#e8d9b0' }} />
                  <Bar dataKey="value" name="Count" radius={[0, 3, 3, 0]}>
                    {ancData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card wide">
              <h3 className="chart-title">Burial Depth Distribution</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={depthBins} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2418" />
                  <XAxis dataKey="depth" tick={{ fill: '#a89870', fontSize: 10 }} angle={-35} textAnchor="end" />
                  <YAxis tick={{ fill: '#a89870', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#1a1610', border: '1px solid #3a3020', color: '#e8d9b0' }} />
                  <Bar dataKey="count" name="Burials" fill="#c97b3a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card wide">
              <h3 className="chart-title">
                Spatial Clusters (
                {clusteringDone && clusterEpsilonUsed != null
                  ? `ε=${clusterEpsilonUsed.toFixed(1)} ft`
                  : 'ε=auto'}
                , min=2, N/E plane)
              </h3>
              <p className="chart-sub">
                {clusteringDone
                  ? `${clusterCount} clusters identified · ${noiseCount} outliers · DBSCAN (plan view), targets ~50–100 clusters`
                  : 'Computing clusters…'}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={clusterBarData} margin={{ top: 5, right: 10, bottom: 40, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-sub)', fontSize: 11 }} angle={-35} textAnchor="end" />
                  <YAxis tick={{ fill: 'var(--text-sub)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                  <Bar dataKey="count" name="Burials" fill="var(--gold)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3 className="chart-title">Key Metrics</h3>
              <div className="metrics-grid">
                <div className="metric-item">
                  <span className="metric-val">{stats.total}</span>
                  <span className="metric-lbl">Total Burials</span>
                </div>
                <div className="metric-item">
                  <span className="metric-val">{stats.knownPersons}</span>
                  <span className="metric-lbl">Named Individuals</span>
                </div>
                <div className="metric-item">
                  <span className="metric-val">{stats.withArtifacts}</span>
                  <span className="metric-lbl">With Artifacts</span>
                </div>
                <div className="metric-item">
                  <span className="metric-val">{stats.withSoftTissue}</span>
                  <span className="metric-lbl">Soft Tissue</span>
                </div>
                <div className="metric-item">
                  <span className="metric-val">{stats.avgDepth} ft</span>
                  <span className="metric-lbl">Avg Depth</span>
                </div>
                <div className="metric-item">
                  <span className="metric-val">
                    {((stats.sex.Male || 0) / stats.total * 100).toFixed(0)}%
                  </span>
                  <span className="metric-lbl">Male</span>
                </div>
                <div className="metric-item">
                  <span className="metric-val">
                    {((stats.sex.Female || 0) / stats.total * 100).toFixed(0)}%
                  </span>
                  <span className="metric-lbl">Female</span>
                </div>
                <div className="metric-item">
                  <span className="metric-val">
                    {(((stats.preservation?.Intact) || 0) / stats.total * 100).toFixed(0)}%
                  </span>
                  <span className="metric-lbl">Intact</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'cluster' && (
        <div className="cluster-layout">
          {!clusteringDone && (
            <div className="cluster-loading">
              <div className="cluster-loading-spinner">⟳</div>
              <p>Running DBSCAN spatial analysis…</p>
              <p className="cluster-loading-sub">
                Sweeping epsilon to find optimal cluster count
              </p>
            </div>
          )}
          {clusteringDone && (
            <>
              <div className="cluster-sidebar">
                <h3 className="sidebar-heading">All Clusters</h3>
                <div className="cluster-show-all">
                  <button
                    type="button"
                    className={`cluster-show-all-btn ${selectedCluster === null ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedCluster(null);
                      setHighlightCluster(null);
                    }}
                  >
                    ◉ Show All Clusters
                  </button>
                </div>
                <div className="cluster-list-scroll">
                  {Array.from(
                    new Set(clusteredData
                      .filter((d) => !d.isNoise)
                      .map((d) => d.clusterId))
                  )
                    .sort((a, b) => {
                      const countA = clusteredData.filter((d) => d.clusterId === a).length;
                      const countB = clusteredData.filter((d) => d.clusterId === b).length;
                      return countB - countA;
                    })
                    .map((cid) => {
                      const burials = clusteredData.filter((d) => d.clusterId === cid);
                      const color = burials[0]?.clusterColor || '#888';
                      return (
                        <div
                          key={cid}
                          className={`cluster-list-item ${selectedCluster === cid ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedCluster(cid);
                            setHighlightCluster(cid);
                          }}
                          style={{ borderLeft: `3px solid ${color}` }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedCluster(cid);
                              setHighlightCluster(cid);
                            }
                          }}
                        >
                          <span className="cli-dot" style={{ background: color }} />
                          <span className="cli-name">Cluster {cid + 1}</span>
                          <span className="cli-count">{burials.length}</span>
                        </div>
                      );
                    })}

                  <div
                    className={`cluster-list-item ${selectedCluster === -1 ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedCluster(-1);
                      setHighlightCluster(-1);
                    }}
                    style={{ borderLeft: '3px solid #555' }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCluster(-1);
                        setHighlightCluster(-1);
                      }
                    }}
                  >
                    <span className="cli-dot" style={{ background: '#555' }} />
                    <span className="cli-name">Outliers</span>
                    <span className="cli-count">
                      {clusteredData.filter((d) => d.isNoise).length}
                    </span>
                  </div>
                </div>
              </div>

              <div className="cluster-3d-pane">
                <ThreeScatter
                  key="cluster-scatter"
                  data={mergedData}
                  colorBy="clusters"
                  clusteredData={clusteredData}
                  filters={EMPTY_FILTERS}
                  onSelect={(burial) => {
                    setSelected(burial);
                    setClusterSelectedBurial(burial);
                  }}
                  selected={clusterSelectedBurial}
                  highlightCluster={highlightCluster}
                  showSurface={showSurface}
                  theme={theme}
                  isClusterView
                />
                {clusterSelectedBurial && (
                  <div className="cluster-mini-record">
                    <div className="cmr-header">
                      <span className="cmr-g">{clusterSelectedBurial.g}</span>
                      <span className="cmr-info">
                        {clusterSelectedBurial.sex} · {clusterSelectedBurial.age}
                        {clusterSelectedBurial.ageCat
                          ? ` (${clusterSelectedBurial.ageCat})` : ''}
                        · {clusterSelectedBurial.depth} ft
                      </span>
                      <button
                        className="cmr-full-btn"
                        type="button"
                        onClick={() => {
                          setSelected(clusterSelectedBurial);
                          setRightTab('record');
                          setActiveTab('scatter');
                        }}
                      >
                        Full Record →
                      </button>
                      <button
                        className="cmr-close"
                        type="button"
                        onClick={() => setClusterSelectedBurial(null)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="cluster-detail">
                <ClusterAnalysis
                  clusterId={selectedCluster}
                  clusteredData={clusteredData}
                  allData={mergedData}
                  clusterPriors={clusterPriors}
                  onSelectBurial={(burial) => {
                    setClusterSelectedBurial(burial);
                  }}
                  onView3D={(cid) => {
                    setActiveTab('scatter');
                    setColorBy('clusters');
                    setHighlightCluster(cid);
                    setSelectedCluster(cid);
                  }}
                  onOpenInMain={(burial) => {
                    setSelected(burial);
                    setRightTab('record');
                    setActiveTab('scatter');
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
