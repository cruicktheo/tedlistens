// The maquette: a scale model of a career.
// Each block is a role; its height is the years spent there.
// Point at a block to aim a controller-style ray at it, drag to move it, select it to read about it.
// In a WebXR headset the model sits on a pedestal and you grab blocks with your controllers.

import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { createXRGallery } from './xr-gallery.js';

const COLORS = {
  plaster: 0xe3e5e2,
  foam: 0xf6f7f5,
  graphite: 0x1d2125,
  ultramarine: 0x2643f0,
};

// Tenure in years, footprint in model metres.
// Laid out chronologically, oldest on the right, so time (and the water) runs right to left on screen.
// Along the flow (x) they run in time order; across it (z) they swing from the front of the
// play area to the back, so the water has to weave between them from the start.
const ROLES = [
  { id: 'fun-and-awe', name: 'Fun and Awe', years: '2025 to now', tenure: 1.45, w: 1.3, d: 1.3, x: -3.5, z: 1.9, current: true },
  { id: 'fitxr', name: 'FitXR', years: '2020 to 2025', tenure: 4.5, w: 1.7, d: 1.3, x: -1.65, z: -1.6 },
  { id: 'virtualretail', name: 'VirtualRetail.io', years: '2019 to 2020', tenure: 1.25, w: 0.9, d: 1.5, x: 0.05, z: 1.25 },
  { id: 'pupil', name: 'Pupil', years: '2017 to 2019', tenure: 1.25, w: 1.4, d: 0.9, x: 1.75, z: -2.0 },
  { id: 'pikpok', name: 'PikPok', years: '2015 to 2017', tenure: 1.85, w: 1.1, d: 1.1, x: 3.6, z: 0.9 },
];

const HEIGHT_PER_YEAR = 0.55;
const BOUNDS = { x: 4.4, z: 2.8 };   // half extents of the play area
const GAP = 0.12;                    // minimum space between blocks
const LIFT = 0.35;                   // how far a held block rises
const XR_SCALE = 0.13;               // model metres to real metres in a headset (tabletop about 1.5 m wide)

const hero = document.querySelector('.hero');
const canvas = document.getElementById('maquette');
const labelLayer = document.getElementById('block-labels');
const vrButton = document.getElementById('enter-vr');
const header = document.querySelector('.site-header');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;

// Header turns solid once the page scrolls past the model.
new IntersectionObserver(([entry]) => {
  header.classList.toggle('is-solid', entry.intersectionRatio < 0.12);
}, { threshold: [0, 0.12, 1] }).observe(hero);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (err) {
  hero.classList.add('no-webgl');
  throw err;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// The scene is light, so spend the headroom on sharpness: no foveated rendering (its tiles show as
// boxy breaks in the ink and soften text) and a framebuffer a little above the recommended size.
renderer.xr.setFoveation(0);
renderer.xr.setFramebufferScaleFactor(1.3);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.plaster);
scene.fog = new THREE.Fog(COLORS.plaster, 16, 34); // retuned per framing in resize()

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);

// ---------- Lighting: overcast studio with one soft key ----------

const hemi = new THREE.HemisphereLight(0xffffff, 0xb4b9be, 2.5);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.9);
sun.position.set(-6, 11, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
const SHADOW_EXTENT = 8;
setShadowExtent(1);
scene.add(sun, sun.target);

function setShadowExtent(scale) {
  const s = SHADOW_EXTENT * scale;
  const cam = sun.shadow.camera;
  cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
  cam.near = 0.5 * scale; cam.far = 40 * scale;
  cam.updateProjectionMatrix();
}

// ---------- The model ----------

const model = new THREE.Group();
scene.add(model);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  // Shadow-only, so the floor is exactly the page colour and the hero has no seam.
  new THREE.ShadowMaterial({ color: COLORS.graphite, opacity: 0.2 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
model.add(floor);

// Cutting-mat grid, faint.
const grid = new THREE.GridHelper(40, 80, COLORS.graphite, COLORS.graphite);
grid.material.transparent = true;
grid.material.opacity = 0.06;
grid.material.depthWrite = false;
grid.position.y = 0.002;
model.add(grid);

// Play-area boundary, drawn like a guardian outline on the floor.
const boundary = makeBoundary(BOUNDS.x + 0.35, BOUNDS.z + 0.35, 0.6);
model.add(boundary);

function makeBoundary(hx, hz, r) {
  const shape = new THREE.Shape();
  shape.moveTo(-hx + r, -hz);
  shape.lineTo(hx - r, -hz);
  shape.quadraticCurveTo(hx, -hz, hx, -hz + r);
  shape.lineTo(hx, hz - r);
  shape.quadraticCurveTo(hx, hz, hx - r, hz);
  shape.lineTo(-hx + r, hz);
  shape.quadraticCurveTo(-hx, hz, -hx, hz - r);
  shape.lineTo(-hx, -hz + r);
  shape.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
  const pts = shape.getPoints(12).map(p => new THREE.Vector3(p.x, 0.004, p.y));
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: COLORS.ultramarine, dashSize: 0.2, gapSize: 0.14, transparent: true, opacity: 0.7 })
  );
  line.computeLineDistances();
  return line;
}

// Base board, only shown in a headset where the model sits on a pedestal.
const board = new THREE.Mesh(
  new THREE.BoxGeometry((BOUNDS.x + 0.8) * 2, 0.3, (BOUNDS.z + 0.8) * 2),
  new THREE.MeshStandardMaterial({ color: 0xd5d8d4, roughness: 1 })
);
board.position.y = -0.151;
board.receiveShadow = true;
board.visible = false;
model.add(board);

const blocks = ROLES.map((role, i) => {
  const h = role.tenure * HEIGHT_PER_YEAR;
  const geo = new THREE.BoxGeometry(role.w, h, role.d);
  geo.translate(0, h / 2, 0);

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: role.current ? COLORS.ultramarine : COLORS.foam,
    roughness: 0.82,
  }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const edgeMat = new THREE.LineBasicMaterial({
    color: role.current ? 0x0f1f8a : COLORS.graphite,
    transparent: true,
    opacity: 0.35,
  });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);

  const group = new THREE.Group();
  group.add(mesh, edges);
  group.position.set(role.x, 0, role.z);
  model.add(group);

  const label = document.createElement('a');
  label.className = 'block-label';
  label.href = `#${role.id}`;
  label.innerHTML = `<span class="name">${role.name}</span><span class="years">${role.years}</span>`;
  labelLayer.appendChild(label);

  const block = {
    role, group, mesh, edgeMat, label, height: h,
    half: { x: role.w / 2, z: role.d / 2 },
    target: new THREE.Vector3(role.x, 0, role.z),
    lift: 0,
    rise: reducedMotion ? 1 : 0,
    riseDelay: 0.25 + i * 0.12,
    held: false,       // held by an XR controller
  };
  mesh.userData.block = block;

  label.addEventListener('pointerenter', () => setHover(block));
  label.addEventListener('pointerleave', () => setHover(null));
  label.addEventListener('focus', () => setHover(block));
  label.addEventListener('blur', () => setHover(null));
  label.addEventListener('click', () => flagRole(role.id));

  return block;
});

const blockMeshes = blocks.map(b => b.mesh);

// ---------- Controller ray (desktop pointer) ----------

// A gently bowed beam with a constant on-screen width. It fades in from the corner
// (colour ramps from the page colour to ultramarine, which reads as transparency on plaster).
const RAY_SEGMENTS = 40;
const rayGeo = new LineGeometry();
rayGeo.setPositions(new Float32Array((RAY_SEGMENTS + 1) * 3));
{
  const colors = [];
  const from = new THREE.Color(COLORS.plaster);
  const to = new THREE.Color(COLORS.ultramarine);
  const c = new THREE.Color();
  for (let i = 0; i <= RAY_SEGMENTS; i++) {
    const t = i / RAY_SEGMENTS;
    c.copy(from).lerp(to, THREE.MathUtils.smoothstep(t, 0, 0.55));
    colors.push(c.r, c.g, c.b);
  }
  rayGeo.setColors(colors);
}
const rayMat = new LineMaterial({ linewidth: 2, vertexColors: true, worldUnits: false, fog: false });
const ray = new Line2(rayGeo, rayMat);
ray.frustumCulled = false;
ray.visible = false;
ray.renderOrder = 2;
scene.add(ray);
const rayCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
const rayPoints = Array.from({ length: RAY_SEGMENTS + 1 }, () => new THREE.Vector3());

// Where the pointer currently lands in the scene, in model space. The wind steers around it.
const cursor = { active: false, point: new THREE.Vector3() };

const reticle = new THREE.Group();
const reticleRing = new THREE.Mesh(
  new THREE.RingGeometry(0.09, 0.12, 40),
  new THREE.MeshBasicMaterial({ color: COLORS.ultramarine, fog: false, depthWrite: false, side: THREE.DoubleSide })
);
const reticleDot = new THREE.Mesh(
  new THREE.CircleGeometry(0.03, 20),
  new THREE.MeshBasicMaterial({ color: COLORS.ultramarine, fog: false, depthWrite: false, side: THREE.DoubleSide })
);
reticle.add(reticleRing, reticleDot);
reticle.visible = false;
reticle.renderOrder = 3;
scene.add(reticle);

// ---------- Camera framing ----------

const view = {
  target: new THREE.Vector3(),
  distance: 17,
  azimuth: 0.62,
  elevation: 0.6,
  parallax: new THREE.Vector2(),     // smoothed
  parallaxGoal: new THREE.Vector2(),
};

function resize() {
  const w = hero.clientWidth;
  const h = hero.clientHeight;
  renderer.setSize(w, h, false);
  rayMat.resolution.set(w, h);
  const aspect = w / h;
  camera.aspect = aspect;

  // Horizontal unit vectors: towards the camera, and screen-right.
  let shiftRight = 0, shiftToward = 0;
  if (aspect >= 1.15) {
    // Wide: model sits to the right of the headline.
    camera.fov = 30;
    view.azimuth = 0.62;
    view.distance = 19;
    shiftRight = -(2.6 + (aspect - 1.15) * 1.3);
    shiftToward = 0.4;
  } else {
    // Tall: look along the model's long side, and sit it in the upper half above the copy.
    camera.fov = 40;
    view.azimuth = 0.9;
    view.distance = 17.5 + (1.15 - aspect) * 8;
    shiftToward = 3.6 + (1.15 - aspect) * 1.5;
    shiftRight = -0.5;   // centre the model, whose front-left block reaches furthest out at this angle
  }
  const az = view.azimuth;
  view.target.set(
    Math.sin(az) * shiftToward + Math.cos(az) * shiftRight,
    0.5,
    Math.cos(az) * shiftToward - Math.sin(az) * shiftRight
  );
  scene.fog.near = view.distance - 1;
  scene.fog.far = view.distance + 18;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function placeCamera() {
  const az = view.azimuth + view.parallax.x * 0.14;
  const el = view.elevation + view.parallax.y * 0.06;
  camera.position.set(
    view.target.x + Math.sin(az) * Math.cos(el) * view.distance,
    view.target.y + Math.sin(el) * view.distance,
    view.target.z + Math.cos(az) * Math.cos(el) * view.distance
  );
  camera.lookAt(view.target);
}

// ---------- Pointer interaction ----------

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const pointerPx = new THREE.Vector2();
let pointerInside = false;
let pointerIsMouse = finePointer;
let hovered = null;
let drag = null;

function readPointer(e) {
  const rect = canvas.getBoundingClientRect();
  pointerPx.set(e.clientX - rect.left, e.clientY - rect.top);
  pointerNdc.set((pointerPx.x / rect.width) * 2 - 1, -(pointerPx.y / rect.height) * 2 + 1);
}

function pickBlock() {
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObjects(blockMeshes, false)[0];
  return hit ? { block: hit.object.userData.block, point: hit.point } : null;
}

function setHover(block) {
  if (hovered === block) return;
  if (hovered) {
    hovered.edgeMat.opacity = 0.35;
    hovered.label.classList.remove('is-active');
  }
  hovered = block;
  if (hovered) {
    hovered.edgeMat.opacity = 1;
    hovered.label.classList.add('is-active');
  }
}

hero.addEventListener('pointermove', e => {
  readPointer(e);
  pointerInside = true;
  pointerIsMouse = e.pointerType === 'mouse';

  if (!reducedMotion && e.pointerType === 'mouse') {
    view.parallaxGoal.set(pointerNdc.x, pointerNdc.y);
  }

  if (drag) {
    updateDrag();
  } else if (e.target === canvas) {
    const hit = pickBlock();
    setHover(hit ? hit.block : null);
    canvas.style.cursor = hit ? 'grab' : '';
  }
});

hero.addEventListener('pointerleave', () => {
  pointerInside = false;
  view.parallaxGoal.set(0, 0);
  if (!drag) setHover(null);
});

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  readPointer(e);
  const hit = pickBlock();
  if (!hit) return;

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
  const local = model.worldToLocal(hit.point.clone());
  drag = {
    block: hit.block,
    plane,
    offset: new THREE.Vector3(local.x - hit.block.target.x, 0, local.z - hit.block.target.z),
    start: pointerPx.clone(),
    moved: false,
    pointerId: e.pointerId,
  };
  setHover(hit.block);
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
});

// On touch screens, only stop the page scrolling when the touch starts on a block.
canvas.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  readPointer(e.touches[0]);
  if (pickBlock()) e.preventDefault();
}, { passive: false });

function updateDrag() {
  if (pointerPx.distanceTo(drag.start) > 5) drag.moved = true;
  if (!drag.moved) return;

  raycaster.setFromCamera(pointerNdc, camera);
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(drag.plane, p)) return;
  model.worldToLocal(p);
  drag.block.target.set(p.x - drag.offset.x, 0, p.z - drag.offset.z);
  clampToBounds(drag.block);
}

function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { block, moved } = drag;
  drag = null;
  canvas.releasePointerCapture(e.pointerId);
  canvas.style.cursor = pointerIsMouse ? 'grab' : '';
  if (!pointerIsMouse) setHover(null);

  if (!moved && e.type === 'pointerup') {
    flagRole(block.role.id);
    document.getElementById(block.role.id).scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    history.replaceState(null, '', `#${block.role.id}`);
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function flagRole(id) {
  document.querySelectorAll('.roles li.is-flagged').forEach(li => li.classList.remove('is-flagged'));
  document.getElementById(id)?.classList.add('is-flagged');
}

// ---------- Simple physics: blocks keep their distance and stay in bounds ----------

function clampToBounds(b) {
  b.target.x = THREE.MathUtils.clamp(b.target.x, -BOUNDS.x + b.half.x, BOUNDS.x - b.half.x);
  b.target.z = THREE.MathUtils.clamp(b.target.z, -BOUNDS.z + b.half.z, BOUNDS.z - b.half.z);
}

function separate() {
  const pinned = drag ? drag.block : null;
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i], b = blocks[j];
        if (a.held || b.held) continue;
        const dx = b.target.x - a.target.x;
        const dz = b.target.z - a.target.z;
        const ox = a.half.x + b.half.x + GAP - Math.abs(dx);
        const oz = a.half.z + b.half.z + GAP - Math.abs(dz);
        if (ox <= 0 || oz <= 0) continue;

        const shareA = a === pinned ? 0 : b === pinned ? 1 : 0.5;
        const shareB = 1 - shareA;
        if (ox < oz) {
          const s = Math.sign(dx) || 1;
          a.target.x -= s * ox * shareA;
          b.target.x += s * ox * shareB;
        } else {
          const s = Math.sign(dz) || 1;
          a.target.z -= s * oz * shareA;
          b.target.z += s * oz * shareB;
        }
      }
    }
    blocks.forEach(clampToBounds);
  }
}

// ---------- WebXR ----------

const pedestal = new THREE.Mesh(
  new THREE.BoxGeometry(1.3, 0.8, 0.85),
  new THREE.MeshStandardMaterial({ color: COLORS.foam, roughness: 0.9 })
);
pedestal.position.set(0, 0.4, -1.2);
pedestal.visible = false;
scene.add(pedestal);

const roomFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 1 })
);
roomFloor.rotation.x = -Math.PI / 2;
roomFloor.receiveShadow = true;
roomFloor.visible = false;
scene.add(roomFloor);

const controllers = [];
const controllerFactory = new XRControllerModelFactory();
const handFactory = new XRHandModelFactory();
const hands = [];

// Tracked hands, drawn as articulated meshes in the same matte foam as the blocks.
const handMaterial = new THREE.MeshStandardMaterial({ color: COLORS.foam, roughness: 0.75 });
function restyleHand(handModel) {
  let found = false;
  handModel.traverse(o => { if (o.isMesh) { o.material = handMaterial; o.castShadow = false; found = true; } });
  return found;
}

for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  const beam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: COLORS.ultramarine })
  );
  beam.scale.z = 2;
  controller.add(beam);
  controller.addEventListener('selectstart', onSelectStart);
  controller.addEventListener('selectend', onSelectEnd);
  controller.addEventListener('squeezestart', () => { if (renderer.xr.isPresenting && readHead()) placeStage(); });
  scene.add(controller);
  controllers.push(controller);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerFactory.createControllerModel(grip));
  scene.add(grip);

  // Remember whether this input is a hand, so its beam and ink sphere can follow the fingertip instead.
  controller.addEventListener('connected', e => { controller.userData.isHand = !!e.data.hand; beam.visible = !e.data.hand; });
  controller.addEventListener('disconnected', () => { controller.userData.isHand = false; });

  const hand = renderer.xr.getHand(i);
  const handModel = handFactory.createHandModel(hand, 'mesh');
  hand.add(handModel);
  scene.add(hand);
  hands.push(hand);
  // The hand mesh loads asynchronously the first time a hand appears; restyle it once it's there.
  hand.addEventListener('connected', () => {
    let tries = 0;
    const wait = setInterval(() => { if (restyleHand(handModel) || ++tries > 50) clearInterval(wait); }, 200);
  });
}

function onSelectStart(e) {
  const controller = e.target;
  if (gallery.select(controller)) return;
  raycaster.setFromXRController(controller);
  const hit = raycaster.intersectObjects(blockMeshes, false)[0];
  if (!hit) return;
  const block = hit.object.userData.block;
  if (block.held) return;
  block.held = true;
  controller.attach(block.group);
  controller.userData.held = block;
}

function onSelectEnd(e) {
  const controller = e.target;
  const block = controller.userData.held;
  if (!block) return;
  model.attach(block.group);
  block.held = false;
  block.target.set(block.group.position.x, 0, block.group.position.z);
  clampToBounds(block);
  controller.userData.held = null;
}

// In a headset the room is a darkened gallery: the table and boards stand in pools of light.
const XR_DARK = new THREE.Color(0x16191d);
const PLASTER = new THREE.Color(COLORS.plaster);
const tableSpot = new THREE.SpotLight(0xffffff, 4.5, 4, 0.55, 0.65, 2);
tableSpot.visible = false;

// In a headset, everything hangs off a stage placed where the visitor is standing and facing:
// the table sits just in front of them, within arm's reach, a little below their eyes.
const stage = new THREE.Group();
scene.add(stage);
stage.add(tableSpot, tableSpot.target);
const TABLE_DISTANCE = 0.62;   // metres from the eyes to the middle of the table
const TABLE_BELOW_EYES = 0.5;
let stagePending = false;

// Head pose straight from the headset; the regular camera still holds the desktop view at first.
const headPos = new THREE.Vector3();
const headQuat = new THREE.Quaternion();
function readHead(frame) {
  if (frame) {
    const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
    if (!pose) return false;
    const { position: p, orientation: o } = pose.transform;
    headPos.set(p.x, p.y, p.z);
    headQuat.set(o.x, o.y, o.z, o.w);
    return true;
  }
  renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, new THREE.Vector3());
  return true;
}

function placeStage() {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  const tableY = THREE.MathUtils.clamp(headPos.y - TABLE_BELOW_EYES, 0.45, 1.3);

  stage.position.set(headPos.x, 0, headPos.z);
  stage.rotation.set(0, yaw, 0);
  model.position.set(0, tableY, -TABLE_DISTANCE);
  pedestal.position.set(0, tableY / 2, -TABLE_DISTANCE);
  pedestal.scale.set(1, tableY / 0.8, 1);
  tableSpot.position.set(0.25, tableY + 1.5, -TABLE_DISTANCE + 0.35);
  tableSpot.target.position.set(0, tableY, -TABLE_DISTANCE);
  stage.updateMatrixWorld(true);

  const centre = model.getWorldPosition(new THREE.Vector3());
  sun.position.set(-6, 11, 7).multiplyScalar(XR_SCALE * 1.5).add(centre);
  sun.target.position.copy(centre);
}

function setXRMode(on) {
  if (on) {
    stage.add(model, pedestal);
    model.scale.setScalar(XR_SCALE);
    stagePending = true;   // wait for the first head pose before placing the table
  } else {
    scene.add(model, pedestal);
    stage.position.set(0, 0, 0);
    stage.rotation.set(0, 0, 0);
    model.position.set(0, 0, 0);
    model.scale.setScalar(1);
    sun.position.set(-6, 11, 7);
    sun.target.position.set(0, 0, 0);
  }
  floor.visible = grid.visible = !on;
  board.visible = pedestal.visible = roomFloor.visible = on;
  pedestal.castShadow = on;
  setShadowExtent(on ? XR_SCALE * 1.4 : 1);
  labelLayer.hidden = on;
  ray.visible = reticle.visible = false;
  gallery.setVisible(on);
  // Dim the room so the table and boards pop.
  scene.background = on ? XR_DARK : PLASTER;
  scene.fog.color.copy(on ? XR_DARK : PLASTER);
  if (on) { scene.fog.near = 2.5; scene.fog.far = 9; }
  hemi.intensity = on ? 0.35 : 2.5;
  sun.intensity = on ? 0.9 : 1.9;
  tableSpot.visible = on;
  // Seen from arm's length, the wash needs less grain and edge wobble than from across the room.
  washMat.uniforms.grain.value = on ? 0.3 : 1;
  washMat.uniforms.warp.value = on ? 0.7 : 2.2;
}

let xrSession = null;

if ('xr' in navigator) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => {
    if (ok) vrButton.hidden = false;
  }).catch(() => {});
}

vrButton.addEventListener('click', async () => {
  if (xrSession) { xrSession.end(); return; }
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    await renderer.xr.setSession(session);
    xrSession = session;
    vrButton.textContent = 'Exit VR';
    setXRMode(true);
    session.addEventListener('end', () => {
      xrSession = null;
      vrButton.textContent = 'View in VR';
      controllers.forEach(c => { if (c.userData.held) onSelectEnd({ target: c }); });
      setXRMode(false);
      resize();
    });
  } catch (err) {
    console.warn('Could not start a VR session', err);
    vrButton.textContent = 'VR unavailable';
    vrButton.disabled = true;
  }
});

// ---------- Ink in water ----------
//
// The floor is a shallow tray of water. A 2D incompressible fluid (stable fluids: semi-Lagrangian
// advection, vorticity confinement, pressure projection) flows across it from the past (right, +x)
// towards now (left, -x). Blocks are solid walls; a dragged block shoves the water with it.
// Ultramarine dye pours in from the right, wraps around the blocks and curls up in their wakes.
// The cursor (or a controller in a headset) is a solid sphere: the water flows around where it
// cuts the surface, and moving it shoves the water like any other obstacle.
// The dye is drawn as a watercolour wash, multiplied onto the floor like a glaze.

const INK = {
  speed: 1.2,             // free-stream speed, model metres per second
  spanX: BOUNDS.x + 1.4,  // simulated area: |x| < spanX
  spanZ: BOUNDS.z + 0.5,
  vorticity: 2.6,         // keeps small swirls alive against numerical damping
  fade: 0.075,             // how quickly ink fades, per second
  sphereRadius: 0.6,      // the cursor's sphere, in model metres
  fingerRadius: 0.22,     // a tracked fingertip's sphere (about 3 cm across in a headset)
  waterLevel: 0.15,       // height of the water surface the sphere cuts through
  bands: 7,               // dye inlets along the right-hand edge
};

const GRID_X = finePointer ? 96 : 64;
const CELL = (2 * INK.spanX) / GRID_X;
const GRID_Z = Math.round((2 * INK.spanZ) / CELL);
const HALF_Z = (GRID_Z * CELL) / 2;
const CELLS = GRID_X * GRID_Z;
const PRESSURE_ITERATIONS = finePointer ? 24 : 16;

const DYE_SCALE = 2;                     // dye is finer than the velocity grid
const DYE_X = GRID_X * DYE_SCALE;
const DYE_Z = GRID_Z * DYE_SCALE;
const DYE_CELL = CELL / DYE_SCALE;

const fluid = {
  u: new Float32Array(CELLS), w: new Float32Array(CELLS),     // velocity along x and z
  u0: new Float32Array(CELLS), w0: new Float32Array(CELLS),
  p: new Float32Array(CELLS), div: new Float32Array(CELLS), curl: new Float32Array(CELLS),
  solid: new Uint8Array(CELLS), su: new Float32Array(CELLS), sw: new Float32Array(CELLS),
  dye: new Float32Array(DYE_X * DYE_Z), dye0: new Float32Array(DYE_X * DYE_Z),
};
fluid.u.fill(-INK.speed);

const toGX = x => (x + INK.spanX) / CELL - 0.5;
const toGZ = z => (z + HALF_Z) / CELL - 0.5;

function bilerp(a, nx, nz, gx, gz) {
  gx = gx < 0 ? 0 : gx > nx - 1.001 ? nx - 1.001 : gx;
  gz = gz < 0 ? 0 : gz > nz - 1.001 ? nz - 1.001 : gz;
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = i + j * nx;
  return (a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fz) + (a[k + nx] * (1 - fx) + a[k + nx + 1] * fx) * fz;
}

// Inlet bands drift slowly up and down the edge so the plumes never settle into fixed stripes.
const bandSeed = Array.from({ length: INK.bands }, (_, b) => ({
  z: -HALF_Z + (b + 0.5) * (2 * HALF_Z / INK.bands),
  phase: Math.random() * Math.PI * 2,
  rate: 0.15 + Math.random() * 0.2,
  strength: 0.75 + Math.random() * 0.35,
}));

function markSolids(spheres) {
  const { solid, su, sw } = fluid;
  solid.fill(0);
  for (const b of blocks) {
    if (b.held) continue;
    const g = b.group.position;
    if (b.height * b.group.scale.y < 0.05 || g.y > 0.5) continue;   // lifted clear of the water
    const i0 = Math.max(0, Math.ceil(toGX(g.x - b.half.x)));
    const i1 = Math.min(GRID_X - 1, Math.floor(toGX(g.x + b.half.x)));
    const j0 = Math.max(0, Math.ceil(toGZ(g.z - b.half.z)));
    const j1 = Math.min(GRID_Z - 1, Math.floor(toGZ(g.z + b.half.z)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = i + j * GRID_X;
      solid[k] = 1; su[k] = b.vel.x; sw[k] = b.vel.z;
    }
  }
  // Each sphere blocks a disc where it cuts the water: widest when the cursor is on the floor,
  // smaller when it rests on a block top, gone when it's well above the water.
  for (const m of spheres) {
    const dy = m.y - INK.waterLevel;
    const slice = m.r * m.r - dy * dy;
    if (slice <= 0) continue;
    const r = Math.sqrt(slice) / CELL;
    const ci = toGX(m.x), cj = toGZ(m.z);
    const i0 = Math.max(1, Math.ceil(ci - r)), i1 = Math.min(GRID_X - 2, Math.floor(ci + r));
    const j0 = Math.max(1, Math.ceil(cj - r)), j1 = Math.min(GRID_Z - 2, Math.floor(cj + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
      const k = i + j * GRID_X;
      solid[k] = 1; su[k] = m.vx; sw[k] = m.vz;
    }
  }
}

function applyBoundaries(t, gust) {
  const { u, w, solid, su, sw } = fluid;
  for (let j = 0; j < GRID_Z; j++) {
    const kr = GRID_X - 1 + j * GRID_X, kl = j * GRID_X;
    u[kr] = -INK.speed * gust;                         // inflow on the right, slightly unsteady
    w[kr] = 0.1 * Math.sin(t * 1.3 + j * 0.4);
    u[kl] = u[kl + 1]; w[kl] = w[kl + 1];              // free outflow on the left
  }
  for (let i = 0; i < GRID_X; i++) {
    const kb = i, kt = i + (GRID_Z - 1) * GRID_X;      // free-slip side walls
    w[kb] = 0; u[kb] = u[kb + GRID_X];
    w[kt] = 0; u[kt] = u[kt - GRID_X];
  }
  for (let k = 0; k < CELLS; k++) if (solid[k]) { u[k] = su[k]; w[k] = sw[k]; }
}

function stepFluid(dt, t, gust, spheres) {
  const { u, w, u0, w0, p, div, curl, solid } = fluid;
  const GX = GRID_X;
  markSolids(spheres);

  // Advect velocity through itself.
  u0.set(u); w0.set(w);
  const s = dt / CELL;
  for (let j = 0; j < GRID_Z; j++) for (let i = 0; i < GX; i++) {
    const k = i + j * GX;
    if (solid[k]) continue;
    const x = i - u0[k] * s, z = j - w0[k] * s;
    u[k] = bilerp(u0, GX, GRID_Z, x, z);
    w[k] = bilerp(w0, GX, GRID_Z, x, z);
  }

  // Vorticity confinement.
  for (let j = 1; j < GRID_Z - 1; j++) for (let i = 1; i < GX - 1; i++) {
    const k = i + j * GX;
    curl[k] = ((w[k + 1] - w[k - 1]) - (u[k + GX] - u[k - GX])) / (2 * CELL);
  }
  const eps = INK.vorticity * CELL * dt;
  for (let j = 2; j < GRID_Z - 2; j++) for (let i = 2; i < GX - 2; i++) {
    const k = i + j * GX;
    if (solid[k]) continue;
    const nx = Math.abs(curl[k + 1]) - Math.abs(curl[k - 1]);
    const nz = Math.abs(curl[k + GX]) - Math.abs(curl[k - GX]);
    const len = Math.hypot(nx, nz) + 1e-5;
    const c = curl[k];
    u[k] += eps * (nz / len) * c;
    w[k] -= eps * (nx / len) * c;
  }

  applyBoundaries(t, gust);

  // Pressure projection: make the flow divergence-free, treating solids as walls.
  for (let j = 1; j < GRID_Z - 1; j++) for (let i = 1; i < GX - 1; i++) {
    const k = i + j * GX;
    div[k] = solid[k] ? 0 : -0.5 * CELL * ((u[k + 1] - u[k - 1]) + (w[k + GX] - w[k - GX]));
  }
  for (let it = 0; it < PRESSURE_ITERATIONS; it++) {
    for (let j = 1; j < GRID_Z - 1; j++) for (let i = 1; i < GX - 1; i++) {
      const k = i + j * GX;
      if (solid[k]) continue;
      let sum = 0, n = 0;
      if (!solid[k - 1]) { sum += p[k - 1]; n++; }
      if (!solid[k + 1]) { sum += p[k + 1]; n++; }
      if (!solid[k - GX]) { sum += p[k - GX]; n++; }
      if (!solid[k + GX]) { sum += p[k + GX]; n++; }
      p[k] = n ? (div[k] + sum) / n : 0;
    }
    for (let j = 0; j < GRID_Z; j++) { p[j * GX] = 0; p[GX - 1 + j * GX] = p[GX - 2 + j * GX]; }
    for (let i = 0; i < GX; i++) { p[i] = p[i + GX]; p[i + (GRID_Z - 1) * GX] = p[i + (GRID_Z - 2) * GX]; }
  }
  for (let j = 1; j < GRID_Z - 1; j++) for (let i = 1; i < GX - 1; i++) {
    const k = i + j * GX;
    if (solid[k]) continue;
    const pc = p[k];
    const pl = solid[k - 1] ? pc : p[k - 1], pr = solid[k + 1] ? pc : p[k + 1];
    const pd = solid[k - GX] ? pc : p[k - GX], pu = solid[k + GX] ? pc : p[k + GX];
    u[k] -= 0.5 * (pr - pl) / CELL;
    w[k] -= 0.5 * (pu - pd) / CELL;
  }
  applyBoundaries(t, gust);

  stepDye(dt, t);
}

function stepDye(dt, t) {
  const { u, w, solid, dye, dye0 } = fluid;
  dye0.set(dye);
  const keep = Math.exp(-dt * INK.fade);
  const s = dt / CELL;

  for (let j = 0; j < DYE_Z; j++) {
    const gz = (j + 0.5) / DYE_SCALE - 0.5;
    for (let i = 0; i < DYE_X; i++) {
      const k = i + j * DYE_X;
      const gx = (i + 0.5) / DYE_SCALE - 0.5;
      const vk = Math.min(GRID_X - 1, i / DYE_SCALE | 0) + Math.min(GRID_Z - 1, j / DYE_SCALE | 0) * GRID_X;
      if (solid[vk]) { dye[k] = 0; continue; }
      const vu = bilerp(u, GRID_X, GRID_Z, gx, gz), vw = bilerp(w, GRID_X, GRID_Z, gx, gz);
      // Trace back in dye-cell units.
      const bx = i - vu * s * DYE_SCALE, bz = j - vw * s * DYE_SCALE;
      dye[k] = bilerp(dye0, DYE_X, DYE_Z, bx, bz) * keep;
    }
  }

  // Inlets: soft bands of ink fed in along the right-hand edge.
  const inlet = Math.max(2, DYE_SCALE * 2);
  for (const band of bandSeed) {
    const bz = band.z + Math.sin(t * band.rate + band.phase) * 0.35;
    const pulse = band.strength * (0.7 + 0.3 * Math.sin(t * band.rate * 2.3 + band.phase * 1.7));
    const width = 0.11 + 0.05 * Math.sin(t * band.rate * 1.7 + band.phase);
    for (let j = 0; j < DYE_Z; j++) {
      const z = -HALF_Z + (j + 0.5) * DYE_CELL;
      const a = Math.exp(-((z - bz) ** 2) / (2 * width * width)) * pulse;
      if (a < 0.01) continue;
      for (let i = DYE_X - inlet; i < DYE_X; i++) {
        const k = i + j * DYE_X;
        dye[k] = Math.max(dye[k], a);
      }
    }
  }
}

// ---------- Watercolour wash ----------

const dyeBytes = new Uint8Array(DYE_X * DYE_Z);
const dyeTexture = new THREE.DataTexture(dyeBytes, DYE_X, DYE_Z, THREE.RedFormat, THREE.UnsignedByteType);
dyeTexture.magFilter = dyeTexture.minFilter = THREE.LinearFilter;
dyeTexture.needsUpdate = true;

function uploadDye() {
  const { dye } = fluid;
  for (let k = 0; k < dye.length; k++) {
    const v = dye[k] * 255;
    dyeBytes[k] = v > 255 ? 255 : v;
  }
  dyeTexture.needsUpdate = true;
}

const washMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  fog: true,
  // Multiply onto the floor like a glaze, so shadows and grid lines show through the ink.
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.DstColorFactor,
  blendDst: THREE.ZeroFactor,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    dye: { value: null },
    texel: { value: new THREE.Vector2(1 / DYE_X, 1 / DYE_Z) },
    pigment: { value: new THREE.Color(COLORS.ultramarine) },
    pigmentDeep: { value: new THREE.Color(0x14228f) },
    aspect: { value: GRID_X / GRID_Z },
    texSize: { value: new THREE.Vector2(DYE_X, DYE_Z) },
    grain: { value: 1 },
    warp: { value: 2.2 },
  }]),
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    #include <fog_pars_vertex>
    void main() {
      vUv = uv;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D dye;
    uniform vec2 texel;
    uniform vec3 pigment;
    uniform vec3 pigmentDeep;
    uniform float aspect;
    uniform vec2 texSize;
    uniform float grain;
    uniform float warp;
    varying vec2 vUv;
    #include <fog_pars_fragment>

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }

    // Smooth (cubic B-spline) lookup from four bilinear taps, so the dye grid never shows up close.
    vec4 cubicWeights(float v) {
      vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
      vec4 s = n * n * n;
      float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
      return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
    }
    float dyeSmooth(vec2 uv) {
      uv = uv * texSize - 0.5;
      vec2 f = fract(uv);
      uv -= f;
      vec4 xc = cubicWeights(f.x), yc = cubicWeights(f.y);
      vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
      vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
      vec4 o = (c + vec4(xc.yw, yc.yw) / s) / texSize.xxyy;
      float s0 = texture2D(dye, o.xz).r, s1 = texture2D(dye, o.yz).r;
      float s2 = texture2D(dye, o.xw).r, s3 = texture2D(dye, o.yw).r;
      float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
      return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
    }

    void main() {
      // The plane's v runs opposite to the simulation's z.
      vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
      vec2 q = uv * vec2(aspect, 1.0);

      // Wobble the lookup a touch so edges look bled rather than sampled.
      vec2 st = uv + (vec2(noise(q * 22.0), noise(q * 22.0 + 7.3)) - 0.5) * texel * warp;

      float d = dyeSmooth(st);
      float dx = texture2D(dye, st + vec2(texel.x * 1.5, 0.0)).r - texture2D(dye, st - vec2(texel.x * 1.5, 0.0)).r;
      float dz = texture2D(dye, st + vec2(0.0, texel.y * 1.5)).r - texture2D(dye, st - vec2(0.0, texel.y * 1.5)).r;

      // Paper tooth: pigment settles unevenly into fine grain.
      float paper = noise(q * 180.0) * 0.4 + noise(q * 48.0) * 0.6;

      float body = smoothstep(0.01, 0.65, d);
      // Watercolour fringe: pigment gathers where the wash thins out at its edges.
      float fringe = clamp(length(vec2(dx, dz)) * 5.0, 0.0, 1.0) * smoothstep(0.02, 0.25, d);
      float a = body * (1.0 - 0.22 * grain * (1.0 - paper)) * 0.72 + fringe * 0.32;

      // Fade out towards the edges of the tray so it never reads as a rectangle.
      float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.9, uv.x) * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.88, uv.y);
      a *= edge;
      #ifdef USE_FOG
        a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif

      vec3 ink = mix(pigment, pigmentDeep, smoothstep(0.4, 1.0, d + fringe * 0.3));
      gl_FragColor = vec4(mix(vec3(1.0), ink, clamp(a, 0.0, 0.9)), 1.0);
      #include <colorspace_fragment>
    }
  `,
});
washMat.uniforms.dye.value = dyeTexture;

const wash = new THREE.Mesh(new THREE.PlaneGeometry(2 * INK.spanX, 2 * HALF_Z), washMat);
wash.rotation.x = -Math.PI / 2;
wash.position.y = 0.003;
wash.renderOrder = 1;
model.add(wash);

// In a headset the tray sits on a board; size the board to the water so no ink overhangs it.
board.geometry.dispose();
board.geometry = new THREE.BoxGeometry(2 * INK.spanX + 0.3, 0.3, 2 * HALF_Z + 0.3);

// ---------- Spheres: the pointer, or controllers in a headset ----------

const spheres = [];
const sphereState = [0, 1, 2, 3, 4].map(() => ({ active: false, prev: new THREE.Vector3(), vel: new THREE.Vector3(), pos: new THREE.Vector3() }));
function trackSphere(state, pos, dt, radius = INK.sphereRadius) {
  if (state.active && dt > 0) state.vel.subVectors(pos, state.prev).divideScalar(dt).clampLength(0, 6);
  else state.vel.set(0, 0, 0);
  state.prev.copy(pos);
  state.active = true;
  spheres.push({ x: pos.x, y: pos.y, z: pos.z, vx: state.vel.x, vz: state.vel.z, r: radius });
}

for (const b of blocks) { b.vel = new THREE.Vector3(); b.prevPos = b.group.position.clone(); }

// Let the water run before anyone sees it, so the first frame already has plumes and wakes.
for (let n = 0; n < 240; n++) stepFluid(1 / 30, n / 30, 1, []);
uploadDye();

let inkClock = 0;

function updateInk(dt, t, inXR) {
  if (reducedMotion) return;   // a still wash, already painted
  const step = Math.min(dt, 1 / 30);
  const gust = 1 + 0.12 * Math.sin(t * 0.5) + 0.05 * Math.sin(t * 1.7);

  for (const b of blocks) {
    const g = b.group.position;
    if (b.held) b.vel.set(0, 0, 0);
    else b.vel.subVectors(g, b.prevPos).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 8);
    b.prevPos.copy(g);
  }

  spheres.length = 0;
  if (inXR) {
    controllers.forEach((c, k) => {
      if (!c.visible || c.userData.isHand) { sphereState[k].active = false; return; }
      c.getWorldPosition(sphereState[k].pos);
      model.worldToLocal(sphereState[k].pos);
      trackSphere(sphereState[k], sphereState[k].pos, dt);
    });
    // With hand tracking, each index fingertip is the sphere: trail a finger through the ink.
    hands.forEach((h, k) => {
      const tip = h.joints && h.joints['index-finger-tip'];
      const st = sphereState[3 + k];
      if (!tip || !tip.visible) { st.active = false; return; }
      tip.getWorldPosition(st.pos);
      model.worldToLocal(st.pos);
      trackSphere(st, st.pos, dt, INK.fingerRadius);
    });
  } else if (cursor.active) {
    trackSphere(sphereState[2], cursor.point, dt);
  } else {
    sphereState[2].active = false;
  }

  // Headsets have far less CPU to spare and must hold 72-90 Hz, so run the water at 30 Hz there.
  if (inXR) {
    inkClock += dt;
    if (inkClock < 1 / 30) return;
    stepFluid(Math.min(inkClock, 1 / 20), t + 8, gust, spheres);
    inkClock = 0;
  } else {
    stepFluid(step, t + 8, gust, spheres);
  }
  uploadDye();
}

// ---------- VR gallery ----------

const gallery = createXRGallery({ renderer, scene, stage, model, camera, blocks, controllers, board });

// ---------- Frame loop ----------

let heroVisible = true;
new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; }).observe(hero);

const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const identity = new THREE.Quaternion();
const easeOut = t => 1 - Math.pow(1 - t, 3);
let elapsed = 0;

renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const inXR = renderer.xr.isPresenting;
  if (!heroVisible && !inXR) return;
  elapsed += dt;

  separate();

  for (const b of blocks) {
    if (b.held) continue;
    const dragging = drag && drag.block === b && drag.moved;
    const k = 1 - Math.exp(-dt * (dragging ? 20 : 11));
    b.group.position.x += (b.target.x - b.group.position.x) * k;
    b.group.position.z += (b.target.z - b.group.position.z) * k;

    const liftGoal = dragging ? LIFT : 0;
    b.lift += (liftGoal - b.lift) * (1 - Math.exp(-dt * 12));
    b.group.position.y += (b.lift - b.group.position.y) * (1 - Math.exp(-dt * 14));

    b.group.quaternion.slerp(identity, 1 - Math.exp(-dt * 10));

    if (b.rise < 1) b.rise = THREE.MathUtils.clamp((elapsed - b.riseDelay) / 0.9, 0, 1);
    b.group.scale.set(1, Math.max(easeOut(b.rise), 0.001), 1);
  }

  updateInk(dt, elapsed, inXR);

  if (inXR) {
    // The head pose arrives a frame or two into the session; place the table once it has.
    if (stagePending && readHead(frame)) { placeStage(); stagePending = false; }
    gallery.update(dt);
  }

  if (!inXR) {
    view.parallax.lerp(view.parallaxGoal, 1 - Math.exp(-dt * 3));
    placeCamera();
    updateRay();
    updateLabels();
  }

  renderer.render(scene, camera);
});

function updateRay() {
  cursor.active = pointerInside;
  const showRay = pointerInside && pointerIsMouse;
  ray.visible = reticle.visible = showRay;
  if (!pointerInside) return;

  raycaster.setFromCamera(pointerNdc, camera);
  const targets = drag ? [drag.block.mesh] : [...blockMeshes, floor];
  const hit = raycaster.intersectObjects(targets, false)[0];
  let end, normal;
  if (hit) {
    end = hit.point;
    normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  } else {
    end = raycaster.ray.at(30, new THREE.Vector3());
    normal = up;
  }
  cursor.point.copy(end);
  model.worldToLocal(cursor.point);
  if (!showRay) return;

  // The beam enters from just past the bottom-right edge, about halfway into the scene,
  // where a right-hand controller would be, and bows upwards slightly on its way to the target.
  const depth = camera.position.distanceTo(end) * 0.45;
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth;
  const origin = rayCurve.v0.set(halfH * camera.aspect * 1.04, -halfH * 1.04, -depth).applyMatrix4(camera.matrixWorld);
  rayCurve.v2.copy(end);
  const bow = origin.distanceTo(end) * 0.12;
  rayCurve.v1.lerpVectors(origin, end, 0.5).addScaledVector(up, bow);

  const arr = rayGeo.attributes.instanceStart.data.array;
  for (let i = 0; i <= RAY_SEGMENTS; i++) rayCurve.getPoint(i / RAY_SEGMENTS, rayPoints[i]);
  for (let i = 0; i < RAY_SEGMENTS; i++) {
    const a = rayPoints[i], b = rayPoints[i + 1], o = i * 6;
    arr[o] = a.x; arr[o + 1] = a.y; arr[o + 2] = a.z;
    arr[o + 3] = b.x; arr[o + 4] = b.y; arr[o + 5] = b.z;
  }
  rayGeo.attributes.instanceStart.data.needsUpdate = true;

  reticle.position.copy(end).addScaledVector(normal, 0.006);
  reticle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const s = THREE.MathUtils.clamp(camera.position.distanceTo(end) / 16, 0.5, 1.6);
  reticle.scale.setScalar(s * (hovered || drag ? 1.25 : 1));
}

function updateLabels() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (const b of blocks) {
    tmp.set(0, b.height * b.group.scale.y + 0.05, 0);
    b.group.localToWorld(tmp);
    tmp.project(camera);
    let x = (tmp.x * 0.5 + 0.5) * w;
    const y = (-tmp.y * 0.5 + 0.5) * h;
    // Keep the tag on screen; its leader line still points at the block.
    const half = (b.labelWidth ||= b.label.offsetWidth) / 2;
    const clamped = THREE.MathUtils.clamp(x, half + 8, w - half - 8);
    b.label.style.setProperty('--leader', `${(x - clamped).toFixed(1)}px`);
    x = clamped;
    b.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, calc(-100% - 12px))`;
    b.label.classList.toggle('is-hidden', b.rise < 0.6);
  }
}
