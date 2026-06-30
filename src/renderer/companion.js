import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import JSZip from 'jszip';

const $ = (id) => document.getElementById(id);

const stage = $('stage');
const loadingEl = $('loading');
const bubble = $('speechBubble');
const characterSelect = $('characterSelect');
const dropZone = $('dropZone');
const zipInput = $('zipInput');
const importStatus = $('importStatus');
const outfitList = $('outfitList');

// =============================================================================
// Scene / renderer
// =============================================================================
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
// Correct color pipeline for VRM/MToon materials. Without sRGB output the
// character looks dim and slightly off-hue; ACES tone mapping + a slightly
// >1 exposure keeps bright neon accents from clipping while lifting shadows.
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.05, 50);
camera.position.set(0, 1.3, 3.2);

// Neutral, fairly bright lighting. The earlier strongly-tinted cyan/pink
// lights were recoloring the model's own textures (washing out skin, dimming
// the outfit). A near-white key + soft fill shows the VRM's true colors; a
// faint cool/warm rim only adds subtle separation without staining the model.
scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(1.0, 2.0, 2.5);
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
fill.position.set(-1.8, 0.8, 1.2);
scene.add(fill);
const rim = new THREE.DirectionalLight(0x6fa8ff, 0.35);
rim.position.set(0, 1.5, -2.0);
scene.add(rim);

let currentVrm = null;
const modelGroup = new THREE.Group();
scene.add(modelGroup);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

function frameCamera(vrm) {
  modelGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const PADDING = 1.3;
  const verticalFov = (camera.fov * Math.PI) / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const distanceForHeight = (size.y * PADDING) / (2 * Math.tan(verticalFov / 2));
  const distanceForWidth = (size.x * PADDING) / (2 * Math.tan(horizontalFov / 2));
  const distance = Math.max(distanceForHeight, distanceForWidth, 0.5);

  camera.position.set(center.x, center.y, center.z + distance);
  camera.lookAt(center);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 10;
  camera.updateProjectionMatrix();
}

function populateOutfitList(vrm) {
  outfitList.innerHTML = '';
  const meshes = [];
  vrm.scene.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh) meshes.push(obj);
  });
  if (meshes.length === 0) {
    outfitList.innerHTML = '<span class="dim">No togglable parts found</span>';
    return;
  }
  meshes.forEach((mesh, i) => {
    const id = `part_${i}`;
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = mesh.visible;
    cb.id = id;
    cb.addEventListener('change', () => { mesh.visible = cb.checked; });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(mesh.name || `part ${i + 1}`));
    outfitList.appendChild(label);
  });
}

function loadModel(url) {
  loadingEl.style.display = 'flex';
  loader.load(
    url,
    (gltf) => {
      const vrm = gltf.userData.vrm;
      if (currentVrm) {
        VRMUtils.deepDispose(currentVrm.scene);
        modelGroup.remove(currentVrm.scene);
      }
      currentVrm = vrm;
      VRMUtils.rotateVRM0(vrm);
      modelGroup.add(vrm.scene);
      modelGroup.scale.setScalar(Number($('sizeSlider').value) / 100);
      frameCamera(vrm);
      resetPoseImmediate();
      populateOutfitList(vrm);
      applyExpression(currentExpression);
      // Eyes: give the VRM lookAt system a target object we move toward the
      // cursor each frame. This rotates the EYES independently of the head,
      // which is what makes the gaze feel alive rather than the whole head
      // swinging. Only some VRMs ship eye bones/lookAt; guarded accordingly.
      if (vrm.lookAt) {
        vrm.lookAt.target = lookAtTarget;
        if (!lookAtTarget.parent) scene.add(lookAtTarget);
      }
      loadingEl.style.display = 'none';
      queueChatter();
    },
    undefined,
    (err) => {
      loadingEl.style.display = 'none';
      console.error('Failed to load VRM model:', err);
      setImportStatus('Failed to load that character — check the console for details.', 'err');
    }
  );
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (currentVrm) frameCamera(currentVrm);
});

// =============================================================================
// Character library
// =============================================================================
async function refreshCharacterList(selectId) {
  const list = (await window.companionAPI?.listCharacters?.()) || [];
  characterSelect.innerHTML = '';
  for (const c of list) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.label + (c.source === 'imported' ? ' (imported)' : '');
    characterSelect.appendChild(opt);
  }
  if (selectId && list.some((c) => c.id === selectId)) characterSelect.value = selectId;
  return list;
}

async function loadCharacterById(id) {
  const url = await window.companionAPI?.getCharacterPath?.(id);
  if (url) loadModel(url);
  window.companionAPI?.setSetting('characterId', id);
}

characterSelect.addEventListener('change', () => loadCharacterById(characterSelect.value));

$('renameBtn').addEventListener('click', async () => {
  const id = characterSelect.value;
  if (!id || id.startsWith('bundled:')) {
    setImportStatus('Only imported characters can be renamed.', 'err');
    return;
  }
  const current = characterSelect.options[characterSelect.selectedIndex]?.textContent.replace(' (imported)', '');
  const next = prompt('New character name:', current);
  if (!next) return;
  const result = await window.companionAPI?.renameCharacter?.(id, next);
  if (result?.ok) {
    await refreshCharacterList(result.id);
    setImportStatus(`Renamed to "${result.label}".`, 'ok');
  } else {
    setImportStatus(`Rename failed: ${result?.error || 'unknown error'}`, 'err');
  }
});

$('deleteBtn').addEventListener('click', async () => {
  const id = characterSelect.value;
  if (!id || id.startsWith('bundled:')) {
    setImportStatus('The bundled character can\'t be deleted.', 'err');
    return;
  }
  if (!confirm('Delete this character? This cannot be undone.')) return;
  const result = await window.companionAPI?.deleteCharacter?.(id);
  if (result?.ok) {
    const list = await refreshCharacterList();
    const fallback = list.find((c) => c.source === 'bundled') || list[0];
    if (fallback) {
      characterSelect.value = fallback.id;
      loadCharacterById(fallback.id);
    }
    setImportStatus('Character deleted.', 'ok');
  } else {
    setImportStatus(`Delete failed: ${result?.error || 'unknown error'}`, 'err');
  }
});

function setImportStatus(text, cls) {
  importStatus.textContent = text;
  importStatus.className = cls || '';
}

async function handleZipFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.zip')) {
    setImportStatus('Please drop a .zip file containing a .vrm model.', 'err');
    return;
  }
  setImportStatus(`Reading ${file.name}…`, 'busy');
  try {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    let entry = null;
    zip.forEach((relPath, zipEntry) => {
      if (!entry && !zipEntry.dir && /\.vrm$/i.test(relPath)) entry = zipEntry;
    });
    if (!entry) {
      setImportStatus('No .vrm file found inside that zip.', 'err');
      return;
    }
    setImportStatus('Importing character…', 'busy');
    const vrmData = await entry.async('arraybuffer');
    const name = entry.name.split('/').pop();
    const result = await window.companionAPI?.importCharacter?.(name, vrmData);
    if (!result?.ok) {
      setImportStatus(`Import failed: ${result?.error || 'unknown error'}`, 'err');
      return;
    }
    await refreshCharacterList(result.id);
    await loadCharacterById(result.id);
    setImportStatus(`Loaded "${result.label}".`, 'ok');
  } catch (err) {
    console.error(err);
    setImportStatus('Could not read that zip — see console for details.', 'err');
  }
}

dropZone.addEventListener('click', () => zipInput.click());
zipInput.addEventListener('change', (e) => handleZipFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); })
);
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  handleZipFile(e.dataTransfer.files && e.dataTransfer.files[0]);
});

// =============================================================================
// Window dragging + edge snapping
// =============================================================================
const dragHandle = $('dragHandle');
let dragging = false, lastX = 0, lastY = 0;
dragHandle.addEventListener('mousedown', (e) => { dragging = true; lastX = e.screenX; lastY = e.screenY; });
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastX, dy = e.screenY - lastY;
  lastX = e.screenX; lastY = e.screenY;
  window.companionAPI?.dragWindow(dx, dy);
  pushDragVelocity(dx, dy); // drives the physics lean/wobble
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  window.companionAPI?.dragEnd(); // snaps to nearest edge/corner if close enough
});

// =============================================================================
// Settings: tabs, switches (single source of truth = the .on class), sliders
// =============================================================================
document.querySelectorAll('.tabBtn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabBtn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tabPanel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

$('gear').addEventListener('click', () => $('panel').classList.toggle('open'));
$('quitBtn').addEventListener('click', () => window.companionAPI?.quit());
$('panelClose').addEventListener('click', () => $('panel').classList.remove('open'));

// ---- Drag the settings panel around by its header (within the window) ----
(() => {
  const panel = $('panel');
  const header = $('panelHeader');
  let pdrag = false, sx = 0, sy = 0, startLeft = 0, startTop = 0;
  header.addEventListener('mousedown', (e) => {
    if (e.target.id === 'panelClose') return;
    pdrag = true;
    const rect = panel.getBoundingClientRect();
    panel.classList.add('dragged');
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    startLeft = rect.left; startTop = rect.top;
    sx = e.clientX; sy = e.clientY;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!pdrag) return;
    let nl = startLeft + (e.clientX - sx);
    let nt = startTop + (e.clientY - sy);
    // keep it on-screen
    nl = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, nl));
    nt = Math.max(0, Math.min(window.innerHeight - 40, nt));
    panel.style.left = nl + 'px';
    panel.style.top = nt + 'px';
  });
  window.addEventListener('mouseup', () => { pdrag = false; });
})();

// ---------------------------------------------------------------------------
// Click-through hover capture. When click-through is ON the whole window
// ignores the mouse — which would trap you, unable to click the gear to turn
// it back off. So whenever the cursor enters an interactive element (gear or
// the open panel) we momentarily re-capture the mouse, and release it again on
// leave. This keeps the desktop clickable "through" the character while the
// settings UI itself stays usable.
let clickThroughActive = false;
const interactiveEls = [$('gear'), $('panel'), $('chatBar')];
interactiveEls.forEach((el) => {
  el.addEventListener('mouseenter', () => {
    if (clickThroughActive) window.companionAPI?.setIgnoreMouse(false);
  });
  el.addEventListener('mouseleave', () => {
    if (clickThroughActive) window.companionAPI?.setIgnoreMouse(true);
  });
});

/**
 * A switch's ON/OFF state lives ONLY in its `.on` class — nothing is tracked
 * in a separate JS variable. Every click reads the class, flips it, then
 * fires the callback with the new boolean. This is the fix for switches
 * "breaking": the old version kept a closure variable that could desync from
 * the visible class state when toggled from two places (UI + IPC broadcast).
 */
function bindSwitch(id, onToggle, persistKey) {
  const el = $(id);
  el.addEventListener('click', () => {
    const next = !el.classList.contains('on');
    el.classList.toggle('on', next);
    onToggle?.(next);
    if (persistKey) window.companionAPI?.setSetting(persistKey, next);
  });
  return {
    set: (v) => el.classList.toggle('on', !!v),
    get: () => el.classList.contains('on'),
  };
}

const topSwitch = bindSwitch('toggleTop', (on) => window.companionAPI?.setAlwaysOnTop(on));
const clickThroughSwitch = bindSwitch('toggleClickThrough', (on) => {
  clickThroughActive = on;
  window.companionAPI?.setClickThrough(on);
  // re-capture immediately if the cursor is still over the panel so the user
  // isn't locked out the instant they flip it on
  if (on) window.companionAPI?.setIgnoreMouse(false);
});
// These two round-trip through the main process (it broadcasts the confirmed
// value back), so the visible switch always reflects ground truth instead of
// an optimistic guess that could drift out of sync.
window.companionAPI?.onAlwaysOnTopChanged((v) => topSwitch.set(v));
window.companionAPI?.onClickThroughChanged((v) => { clickThroughActive = v; clickThroughSwitch.set(v); });

const chatterSwitch = bindSwitch('toggleChatter', null, 'chatterEnabled');
const autoSleepSwitch = bindSwitch('toggleAutoSleep', null, 'autoSleep');
const cpuWarnSwitch = bindSwitch('toggleCpuWarn', null, 'cpuWarnEnabled');
const minimalSwitch = bindSwitch('toggleMinimal', (on) => {
  document.body.classList.toggle('minimal', on);
}, 'minimalMode');
const startupSwitch = bindSwitch('toggleStartup', (on) => {
  window.companionAPI?.setStartup(on);
});
const muteSwitch = bindSwitch('toggleMute', null, 'muted');
const clipboardSwitch = bindSwitch('toggleClipboard', (on) => {
  window.companionAPI?.setWatchClipboard(on);
  showBubble(on ? 'Okay, I\'ll glance at your clipboard for context.' : 'Stopped watching your clipboard.');
}, 'watchClipboard');

// animation feature toggles (mutate the `features` flags consumed by the loop)
bindSwitch('toggleEyeTracking', (on) => { features.eyeTracking = on; }, 'eyeTracking');
bindSwitch('toggleIdleVariation', (on) => { features.idleVariation = on; }, 'idleVariation');
bindSwitch('togglePhysics', (on) => { features.physicsReactions = on; }, 'physicsReactions');
const walkSwitch = bindSwitch('toggleWalk', (on) => {
  features.walk = on;
  if (!on && behavior === 'walk') setBehavior('idle');
}, 'walkEnabled');

// AI feature toggles
bindSwitch('toggleMemory', null, 'memoryEnabled');
bindSwitch('toggleVision', null, 'visionEnabled');
const ttsSwitch = bindSwitch('toggleTTS', (on) => {
  $('ttsRow').style.display = on ? 'block' : 'none';
}, 'ttsEnabled');

$('sizeSlider').addEventListener('input', (e) => {
  const scale = e.target.value / 100;
  $('sizeVal').textContent = e.target.value + '%';
  modelGroup.scale.setScalar(scale);
  window.companionAPI?.setSetting('size', Number(e.target.value));
});
$('swaySlider').addEventListener('input', (e) => {
  swaySpeed = e.target.value / 100;
  $('swayVal').textContent = swaySpeed.toFixed(1) + 'x';
  window.companionAPI?.setSetting('swaySpeed', Number(e.target.value));
});
$('behaviorSelect').addEventListener('change', (e) => {
  setBehavior(e.target.value);
  window.companionAPI?.setSetting('behavior', e.target.value);
});
$('expressionSelect').addEventListener('change', (e) => {
  currentExpression = e.target.value;
  applyExpression(currentExpression);
  window.companionAPI?.setSetting('expression', currentExpression);
});
$('volSlider').addEventListener('input', (e) => {
  voiceVolume = Number(e.target.value) / 100;
  $('volVal').textContent = e.target.value + '%';
  window.companionAPI?.setSetting('volume', Number(e.target.value));
});

$('summonBtn').addEventListener('click', () => {
  if (!features.walk) { showBubble('Turn on Walk / wander first!'); return; }
  summonToCursor();
});
$('clearMemoryBtn').addEventListener('click', async () => {
  await window.companionAPI?.memoryClear();
  showBubble('Memory cleared.');
});

// ---- AI provider settings ----
function updateProviderUI() {
  const isOllama = aiProvider === 'ollama';
  $('apiKeyRow').style.display = isOllama ? 'none' : 'block';
  $('ollamaRow').style.display = isOllama ? 'block' : 'none';
}
$('providerSelect').addEventListener('change', async (e) => {
  aiProvider = e.target.value;
  window.companionAPI?.setSetting('aiProvider', aiProvider);
  updateProviderUI();
  await loadApiKeyIntoField();
});
$('modelInput').addEventListener('change', (e) => window.companionAPI?.setSetting('aiModel', e.target.value));
$('apiKeyInput').addEventListener('change', async (e) => {
  const all = (await window.companionAPI?.getAllSettings?.()) || {};
  const apiKeys = all.apiKeys || {};
  apiKeys[aiProvider] = e.target.value;
  window.companionAPI?.setSetting('apiKeys', apiKeys);
  $('apiKeyStatus').textContent = e.target.value ? 'Key saved locally.' : '';
});
$('ollamaUrlInput').addEventListener('change', (e) => window.companionAPI?.setSetting('ollamaUrl', e.target.value));
$('ollamaModelInput').addEventListener('change', (e) => window.companionAPI?.setSetting('ollamaModel', e.target.value));
$('ollamaCheckBtn').addEventListener('click', async () => {
  $('ollamaStatus').textContent = 'Checking…';
  await window.companionAPI?.setSetting('ollamaUrl', $('ollamaUrlInput').value);
  const res = await window.companionAPI?.checkOllama();
  $('ollamaStatus').textContent = res?.ok
    ? `Connected. Models: ${(res.models || []).join(', ') || '(none pulled)'}`
    : 'Could not reach Ollama. Is it running?';
});

// ---- TTS settings ----
$('ttsProviderSelect').addEventListener('change', (e) => window.companionAPI?.setSetting('ttsProvider', e.target.value));
$('ttsVoiceInput').addEventListener('change', (e) => window.companionAPI?.setSetting('ttsVoice', e.target.value));
$('elevenKeyInput').addEventListener('change', async (e) => {
  const all = (await window.companionAPI?.getAllSettings?.()) || {};
  const apiKeys = all.apiKeys || {};
  apiKeys.elevenlabs = e.target.value;
  window.companionAPI?.setSetting('apiKeys', apiKeys);
});

async function loadApiKeyIntoField() {
  const all = (await window.companionAPI?.getAllSettings?.()) || {};
  const apiKeys = all.apiKeys || {};
  $('apiKeyInput').value = apiKeys[aiProvider] || '';
  $('apiKeyStatus').textContent = apiKeys[aiProvider] ? 'Key saved locally.' : 'No key set yet.';
}

// =============================================================================
// Pose system
// =============================================================================
// A VRM's bind pose is a T-pose: arms straight out horizontally, every bone at
// rotation zero. To bring an arm DOWN to the side you rotate the upper arm
// about its Z axis. The direction of that rotation depends on the rig's axis
// convention. Rather than scatter +/- signs through every pose (which is what
// made them inconsistent — some poses fought the base pose), ALL arm rotations
// below are expressed as multiples of ARM_DOWN, a single signed constant for
// "rotate the LEFT arm one unit toward the body's side." The right arm uses
// the mirror automatically. Flip ARM_DOWN's sign in ONE place if a model's
// arms raise instead of lower.
//
// Convention used here (matches the standard VRM/three-vrm normalized space):
//   left upper arm, +Z  => arm rotates DOWN to the left side
//   right upper arm, -Z => arm rotates DOWN to the right side
const ARM_DOWN = 1.25; // ~72°: T-pose (horizontal) down to nearly vertical at the sides

// Helper: arm rotation expressed in "down units." `lift` 0 = fully down at the
// side (rest), 1 = back up to horizontal (T-pose), >1 = above horizontal.
// Returns the correct signed Z for whichever side. amt is the lift fraction.
function armZ(side, lift) {
  // lift 0 -> full down (ARM_DOWN), lift 1 -> 0 (horizontal), lift 2 -> -ARM_DOWN (up)
  const z = ARM_DOWN * (1 - lift);
  return side === 'left' ? z : -z;
}

const BASE_POSE = {
  chest: { x: 0, y: 0, z: 0 },
  spine: { x: 0, y: 0, z: 0 },
  hips: { x: 0, y: 0, z: 0 },
  head: { x: 0, y: 0, z: 0 },
  // Arms relaxed down at the sides with a small outward gap, plus a slight
  // forward+inward angle and a gentle resting elbow bend. Real arms are never
  // perfectly straight or pinned flat to the body — this is what kills the
  // "stiff mannequin" look in the neutral pose.
  leftUpperArm: { x: 0.08, y: 0, z: armZ('left', 0.10) },
  rightUpperArm: { x: 0.08, y: 0, z: armZ('right', 0.10) },
  leftLowerArm: { x: 0, y: 0.18, z: 0.25 },
  rightLowerArm: { x: 0, y: -0.18, z: -0.25 },
  leftHand: { x: 0, y: 0, z: 0.1 },
  rightHand: { x: 0, y: 0, z: -0.1 },
  leftUpperLeg: { x: 0, y: 0, z: 0.02 },
  rightUpperLeg: { x: 0, y: 0, z: -0.02 },
  leftLowerLeg: { x: 0.04, y: 0, z: 0 },
  rightLowerLeg: { x: 0.04, y: 0, z: 0 },
};

let behavior = 'idle';
let swaySpeed = 1.0;
let poseStartTime = 0;
let lastInteractionTime = performance.now();
let asleep = false;

function setBehavior(b) {
  behavior = b;
  poseStartTime = clock.getElapsedTime();
  lastInteractionTime = performance.now();
  if (asleep) wakeUp();
}

function bone(name) {
  return currentVrm?.humanoid?.getNormalizedBoneNode(name) || null;
}

const TRACKED_BONES = Object.keys(BASE_POSE);
const _targetEuler = new THREE.Euler();
const _targetQuat = new THREE.Quaternion();

// World-space object the VRM eyes aim at (positioned in front of the model and
// offset toward the cursor each frame).
const lookAtTarget = new THREE.Object3D();

// Feature flags, hydrated from settings on boot.
const features = {
  eyeTracking: true,
  idleVariation: true,
  physicsReactions: true,
  walk: false,
};

function resetPoseImmediate() {
  TRACKED_BONES.forEach((n) => {
    const b = bone(n);
    if (b) b.rotation.set(BASE_POSE[n].x, BASE_POSE[n].y, BASE_POSE[n].z);
  });
  modelGroup.position.y = 0;
}

// Eye/head tracking offset, updated from the main-process cursor broadcast.
let cursorX = 0, cursorY = 0;
window.companionAPI?.onCursorPosition((p) => { cursorX = p.x; cursorY = p.y; });

function add(targets, name, dx = 0, dy = 0, dz = 0) {
  if (!targets[name]) return;
  targets[name].x += dx; targets[name].y += dy; targets[name].z += dz;
}
function setAbs(targets, name, x, y, z) {
  if (!targets[name]) return;
  targets[name].x = x; targets[name].y = y; targets[name].z = z;
}

// Set a whole arm ABSOLUTELY (overriding the base) in human terms:
//   lift  : 0 = down at side, 1 = straight out (T), 1.5 = up at ~135°, 2 = straight up
//   fwd   : how far the arm swings forward (toward the viewer), radians on X
//   bend  : elbow bend amount, 0 = straight, ~1.6 = right angle (always folds inward)
function armLift(targets, side, lift, fwd = 0, bend = 0) {
  const upper = side === 'left' ? 'leftUpperArm' : 'rightUpperArm';
  const lower = side === 'left' ? 'leftLowerArm' : 'rightLowerArm';
  setAbs(targets, upper, fwd, 0, armZ(side, lift));
  // elbow always bends the forearm toward the body's centerline, regardless of side
  setAbs(targets, lower, 0, 0, side === 'left' ? bend : -bend);
}

// ---------------------------------------------------------------------------
// Pose library — each fn receives `targets` (already holding BASE_POSE + idle
// breathing/sway) and shapes it. Arm poses use armLift() so they're expressed
// as absolute lift levels in the SAME convention as the base, instead of raw
// signed radians that could fight the base pose. `el` = seconds since this
// behavior was selected.
// ---------------------------------------------------------------------------
const POSES = {
  idle: { label: 'Idle / breathing', fn: () => {} },

  look: {
    label: 'Look around',
    fn: (t, el, targets) => {
      add(targets, 'head', Math.sin(t * 0.33) * 0.1, Math.sin(t * 0.5) * 0.4, 0);
    },
  },

  wave: {
    label: 'Greeting wave',
    fn: (t, el, targets) => {
      const raise = Math.min(el / 0.4, 1);
      const wiggle = Math.sin(el * 9) * 0.4;
      // upper arm lifts out to ~135°, elbow bent up, hand wags
      armLift(targets, 'right', 0.55 + 0.85 * raise, 0.1 * raise, 1.0 * raise);
      add(targets, 'rightLowerArm', 0, 0, wiggle); // wag on top of the bend
      add(targets, 'head', 0, -0.15 * raise, 0);
    },
  },

  wind: {
    label: 'Wind gust (strong)',
    fn: (t, el, targets) => {
      const gust = Math.sin(t * 2.1) * 0.5 + Math.sin(t * 5.3) * 0.18;
      add(targets, 'spine', 0.05, 0, 0.10 + gust * 0.04);
      add(targets, 'chest', 0, 0, 0.06 + gust * 0.03);
      add(targets, 'head', 0, -0.08 - gust * 0.05, -0.05);
      // arms lift slightly off the sides as if pushed by wind
      armLift(targets, 'left', 0.18 + gust * 0.05);
      armLift(targets, 'right', 0.18 + gust * 0.05);
    },
  },

  sit: {
    label: 'Sit / perch',
    fn: (t, el, targets) => {
      setAbs(targets, 'leftUpperLeg', -1.4, 0, 0.1);
      setAbs(targets, 'rightUpperLeg', -1.4, 0, -0.1);
      setAbs(targets, 'leftLowerLeg', 1.5, 0, 0);
      setAbs(targets, 'rightLowerLeg', 1.5, 0, 0);
      add(targets, 'hips', 0.05, 0, 0);
      armLift(targets, 'left', 0.12, 0.2, 0.3);
      armLift(targets, 'right', 0.12, 0.2, 0.3);
      modelGroup.position.y = -0.15;
    },
  },

  thinking: {
    label: 'Thinking',
    fn: (t, el, targets) => {
      // hand to chin: arm partly raised, elbow strongly bent, head tilted
      armLift(targets, 'right', 0.5, 0.5, 1.7);
      add(targets, 'head', 0.1, 0, -0.12);
    },
  },

  still: { label: 'Freeze pose', freeze: true, fn: () => {} },

  bow: {
    label: 'Bow',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.5, 1) * (el < 1.5 ? 1 : Math.max(0, 1 - (el - 1.5) / 0.5));
      add(targets, 'spine', 0.55 * d, 0, 0);
      add(targets, 'head', 0.15 * d, 0, 0);
    },
  },

  salute: {
    label: 'Salute',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      // hand to forehead: arm up to horizontal-ish, elbow folded toward head
      armLift(targets, 'right', 0.5 + 0.5 * d, 0.2 * d, 1.9 * d);
    },
  },

  clap: {
    label: 'Clap',
    fn: (t, el, targets) => {
      const clapPhase = Math.abs(Math.sin(el * 6));
      // both arms up in front, elbows bent so hands meet at center
      armLift(targets, 'left', 0.7, 0.7, 1.0 + clapPhase * 0.3);
      armLift(targets, 'right', 0.7, 0.7, 1.0 + clapPhase * 0.3);
    },
  },

  cheer: {
    label: 'Cheer (arms up)',
    fn: (t, el, targets) => {
      const wobble = Math.sin(el * 5) * 0.1;
      armLift(targets, 'left', 2.0 + wobble);
      armLift(targets, 'right', 2.0 + wobble);
      add(targets, 'head', -0.1, 0, 0);
    },
  },

  shrug: {
    label: 'Shrug',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      add(targets, 'chest', 0, 0, 0.08 * d);
      // arms lift slightly out, palms-up elbow bend
      armLift(targets, 'left', 0.25 * d, 0.1 * d, 0.7 * d);
      armLift(targets, 'right', 0.25 * d, 0.1 * d, 0.7 * d);
      add(targets, 'head', 0.05 * d, 0, 0);
    },
  },

  point: {
    label: 'Point forward',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      // straight arm raised forward toward the viewer
      armLift(targets, 'right', 0.85 * d + 0.06 * (1 - d), 0.9 * d, 0);
    },
  },

  peace: {
    label: 'Peace sign',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      // arm up beside head, elbow bent
      armLift(targets, 'right', 0.5 + 0.7 * d, 0.2 * d, 1.4 * d);
      add(targets, 'head', 0, -0.15 * d, -0.05 * d);
    },
  },

  dance: {
    label: 'Dance',
    fn: (t, el, targets) => {
      add(targets, 'hips', 0, Math.sin(el * 3) * 0.3, Math.sin(el * 3) * 0.15);
      add(targets, 'spine', 0, Math.sin(el * 3 + 0.5) * 0.15, 0);
      const swing = Math.sin(el * 3);
      armLift(targets, 'left', 1.1 + swing * 0.4, 0.2, 0.6);
      armLift(targets, 'right', 1.1 - swing * 0.4, 0.2, 0.6);
      add(targets, 'head', 0, Math.sin(el * 3) * 0.2, 0);
      modelGroup.position.y = Math.abs(Math.sin(el * 3)) * 0.03;
    },
  },

  stretch: {
    label: 'Stretch',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.6, 1);
      armLift(targets, 'left', 1.85 * d + 0.06 * (1 - d));
      armLift(targets, 'right', 1.85 * d + 0.06 * (1 - d));
      add(targets, 'spine', -0.15 * d, 0, 0);
      add(targets, 'head', -0.1 * d, 0, 0);
    },
  },

  yawn: {
    label: 'Yawn',
    fn: (t, el, targets) => {
      const d = el < 1.2 ? Math.sin((el / 1.2) * Math.PI) : 0;
      // one arm rises to cover mouth, elbow bent
      armLift(targets, 'right', 0.5 + 0.5 * d, 0.3 * d, 1.6 * d);
      add(targets, 'head', -0.2 * d, 0, 0);
    },
  },

  facepalm: {
    label: 'Facepalm',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      // hand to face: arm raised, elbow heavily folded
      armLift(targets, 'right', 0.5 + 0.55 * d, 0.5 * d, 2.0 * d);
      add(targets, 'head', 0.2 * d, 0, 0.1 * d);
    },
  },

  crossarms: {
    label: 'Arms crossed',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      // both arms in toward chest, elbows folded so forearms cross
      armLift(targets, 'left', 0.35 * d, 0.4 * d, 1.5 * d);
      armLift(targets, 'right', 0.35 * d, 0.4 * d, 1.5 * d);
      add(targets, 'leftLowerArm', 0, 0.4 * d, 0);
      add(targets, 'rightLowerArm', 0, -0.4 * d, 0);
      add(targets, 'chest', 0.05 * d, 0, 0);
    },
  },

  handsonhips: {
    label: 'Hands on hips',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      armLift(targets, 'left', 0.18 * d, 0.1 * d, 1.3 * d);
      armLift(targets, 'right', 0.18 * d, 0.1 * d, 1.3 * d);
      add(targets, 'leftLowerArm', 0, 0.7 * d, 0);
      add(targets, 'rightLowerArm', 0, -0.7 * d, 0);
      add(targets, 'chest', -0.05 * d, 0, 0);
    },
  },

  jump: {
    label: 'Jump / bounce',
    fn: (t, el, targets) => {
      const bounce = Math.abs(Math.sin(el * 4));
      modelGroup.position.y = bounce * 0.08;
      armLift(targets, 'left', 0.06 + 1.6 * bounce);
      armLift(targets, 'right', 0.06 + 1.6 * bounce);
      add(targets, 'leftUpperLeg', -0.3 * bounce, 0, 0);
      add(targets, 'rightUpperLeg', -0.3 * bounce, 0, 0);
    },
  },

  spin: {
    label: 'Spin',
    fn: (t, el, targets) => {
      modelGroup.rotation.y = el * 3.2;
      armLift(targets, 'left', 1.0);
      armLift(targets, 'right', 1.0);
    },
  },

  bashful: {
    label: 'Bashful',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      // hands clasped low in front, head tilted shyly
      armLift(targets, 'left', 0.15 * d + 0.06 * (1 - d), 0.3 * d, 0.6 * d);
      armLift(targets, 'right', 0.15 * d + 0.06 * (1 - d), 0.3 * d, 0.6 * d);
      add(targets, 'leftLowerArm', 0, 0.4 * d, 0);
      add(targets, 'rightLowerArm', 0, -0.4 * d, 0);
      add(targets, 'head', 0.2 * d, 0.15 * d, 0.05 * d);
    },
  },

  kneel: {
    label: 'Kneel',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.5, 1);
      setAbs(targets, 'leftUpperLeg', -1.9 * d, 0, 0.1);
      setAbs(targets, 'rightUpperLeg', -0.4 * d, 0, -0.1);
      setAbs(targets, 'leftLowerLeg', 2.2 * d, 0, 0);
      setAbs(targets, 'rightLowerLeg', 0.3 * d, 0, 0);
      add(targets, 'spine', 0.1 * d, 0, 0);
      modelGroup.position.y = -0.25 * d;
    },
  },

  applaud: {
    label: 'Applaud',
    fn: (t, el, targets) => {
      const clapPhase = Math.abs(Math.sin(el * 7));
      armLift(targets, 'left', 0.6, 0.6, 1.1 + clapPhase * 0.3);
      armLift(targets, 'right', 0.6, 0.6, 1.1 + clapPhase * 0.3);
      add(targets, 'head', -0.05, 0, 0);
    },
  },

  confused: {
    label: 'Confused',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      add(targets, 'head', 0, 0, 0.25 * d + Math.sin(el * 2) * 0.05);
      // one hand scratches head
      armLift(targets, 'right', 0.5 + 0.6 * d, 0.3 * d, 1.7 * d);
    },
  },

  determined: {
    label: 'Determined stance',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);
      // fists at sides, slight forward lean
      armLift(targets, 'left', 0.1 * d + 0.06 * (1 - d), 0.1 * d, 0.5 * d);
      armLift(targets, 'right', 0.1 * d + 0.06 * (1 - d), 0.1 * d, 0.5 * d);
      add(targets, 'chest', -0.06 * d, 0, 0);
      add(targets, 'head', -0.05 * d, 0, 0);
    },
  },

  leanback: {
    label: 'Lean back, relaxed',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.5, 1);
      add(targets, 'spine', -0.18 * d, 0, 0);
      add(targets, 'chest', -0.1 * d, 0, 0);
      add(targets, 'head', -0.08 * d, 0, 0);
      armLift(targets, 'left', 0.2 * d + 0.06 * (1 - d));
      armLift(targets, 'right', 0.2 * d + 0.06 * (1 - d));
    },
  },

  walk: {
    label: 'Walk / wander',
    fn: (t, el, targets) => {
      // alternating leg stride + opposite arm swing
      const stride = Math.sin(el * 7);
      add(targets, 'leftUpperLeg', stride * 0.5, 0, 0);
      add(targets, 'rightUpperLeg', -stride * 0.5, 0, 0);
      add(targets, 'leftLowerLeg', Math.max(0, -stride) * 0.6, 0, 0);
      add(targets, 'rightLowerLeg', Math.max(0, stride) * 0.6, 0, 0);
      armLift(targets, 'left', 0.06, -stride * 0.2, 0.15);
      armLift(targets, 'right', 0.06, stride * 0.2, 0.15);
      add(targets, 'spine', 0.05, stride * 0.05, 0);
      modelGroup.position.y = Math.abs(Math.sin(el * 14)) * 0.01;
    },
  },
};

// Populate the behavior dropdown from the pose library above instead of
// hand-written <option> tags, so the 20+ extra poses are all available.
(() => {
  const sel = $('behaviorSelect');
  sel.innerHTML = '';
  Object.entries(POSES).forEach(([key, def]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = def.label;
    sel.appendChild(opt);
  });
  sel.value = behavior;
})();

function computePoseTargets(t, el) {
  const targets = {};
  TRACKED_BONES.forEach((n) => (targets[n] = { ...BASE_POSE[n] }));

  const def = POSES[behavior] || POSES.idle;
  if (def.freeze) return null; // 'still' — leave bones exactly where they are

  // Multiple slow oscillators at unrelated frequencies, so the idle never
  // looks like a single repeating sine wave. Breathing drives chest+spine+
  // shoulders together; a much slower cycle shifts the body weight side to
  // side; tiny high-frequency noise keeps limbs from ever being dead-still.
  const amp = asleep ? 0.4 : 1;
  const breathe = Math.sin(t * 1.4 * swaySpeed) * 0.02 * amp;
  const sway = Math.sin(t * 0.6 * swaySpeed) * 0.05 * amp;
  const weight = Math.sin(t * 0.22 * swaySpeed) * 0.06 * amp;     // slow weight shift
  const drift = Math.sin(t * 0.9 + 1.3) * 0.015 * amp;            // secondary arm drift
  const microL = Math.sin(t * 2.3 + 0.5) * 0.01 * amp;
  const microR = Math.sin(t * 2.1 + 2.1) * 0.01 * amp;            // different phase per side

  // breathing spread across the torso chain, not just one bone
  add(targets, 'chest', breathe * 0.6, 0, breathe);
  add(targets, 'spine', breathe * 0.3, sway * 0.4, weight * 0.5);
  add(targets, 'hips', 0, 0, weight);                            // hips lead the weight shift
  // weight shift bends the opposite knee slightly, like real standing
  add(targets, 'leftUpperLeg', 0, 0, weight * 0.4);
  add(targets, 'rightUpperLeg', 0, 0, weight * 0.4);

  // arms breathe/drift independently per side so they're never mirror-identical
  add(targets, 'leftUpperArm', microL, 0, sway * 0.08 + drift + breathe * 0.4);
  add(targets, 'rightUpperArm', microR, 0, -sway * 0.08 - drift - breathe * 0.4);
  add(targets, 'leftLowerArm', 0, microL * 2, 0);
  add(targets, 'rightLowerArm', 0, -microR * 2, 0);

  const eyeYaw = cursorX * 0.4;
  const eyePitch = -cursorY * 0.25;

  if (asleep) {
    add(targets, 'head', 0.35 + breathe, 0, 0.1); // chin down, gentle breathing
  } else {
    // head leads the weight shift slightly and follows the cursor
    add(targets, 'head', breathe * 0.5 + eyePitch, sway * 0.6 + eyeYaw - weight * 0.3, weight * 0.4);
  }

  if (!asleep) def.fn(t, el, targets);

  return targets;
}

// click/drag "reaction" — a brief squish + surprised expression
let reactionUntil = 0;
stage.addEventListener('mousedown', () => {
  reactionUntil = performance.now() + 260;
  lastInteractionTime = performance.now();
  if (asleep) wakeUp();
  flashExpression('surprised', 700);
});

function wakeUp() {
  asleep = false;
  showBubble('*wakes up*');
}

const clock = new THREE.Clock();
const SMOOTH = 14; // higher = snappier easing, lower = floatier

function applyPoseSmoothed(dt, t) {
  if (!currentVrm?.humanoid) return;

  const el = t - poseStartTime;
  if (behavior !== 'spin') modelGroup.rotation.y = THREE.MathUtils.lerp(modelGroup.rotation.y, 0, 1 - Math.exp(-6 * dt));
  if (!['dance', 'jump', 'kneel'].includes(behavior)) {
    modelGroup.position.y = THREE.MathUtils.lerp(modelGroup.position.y, 0, 1 - Math.exp(-6 * dt));
  }

  const targets = computePoseTargets(t, el);
  if (!targets) return; // 'still' — freeze exactly as-is

  const alpha = 1 - Math.exp(-SMOOTH * dt); // framerate-independent easing

  // IMPORTANT: interpolate rotations as quaternions (slerp), not as separate
  // x/y/z Euler angles. Lerping each Euler axis independently does NOT
  // produce a valid in-between rotation when more than one axis changes at
  // once — the result can be an orientation that isn't actually "between"
  // the start and end poses at all, which is exactly what produced limbs
  // snapping into nonsense positions mid-transition between poses.
  TRACKED_BONES.forEach((name) => {
    const b = bone(name);
    if (!b) return;
    const target = targets[name];
    _targetEuler.set(target.x, target.y, target.z, 'XYZ');
    _targetQuat.setFromEuler(_targetEuler);
    b.quaternion.slerp(_targetQuat, alpha);
  });

  // click squish reaction (scale pulse on the whole model)
  const now = performance.now();
  const squish = now < reactionUntil ? 0.92 : 1.0;
  const targetScale = (Number($('sizeSlider').value) / 100) * squish;
  modelGroup.scale.setScalar(THREE.MathUtils.lerp(modelGroup.scale.x, targetScale, 1 - Math.exp(-20 * dt)));

  if (currentVrm && !['dance', 'jump', 'kneel'].includes(behavior)) {
    currentVrm.scene.position.y = asleep ? 0 : Math.sin(t * 1.2 * swaySpeed) * 0.01;
  }
}

// ---------------------------------------------------------------------------
// Ambient wind. Runs every frame so hair/cloth are always alive. The key to
// hair actually *blowing* (vs. just hanging) is driving the spring bones'
// gravityPOWER (force magnitude), not only gravityDir — gravityDir is a unit
// vector, so changing it alone just re-aims the same small force. Here both
// the direction AND the strength swing with layered sine waves at unrelated
// frequencies to fake turbulence. The "wind gust" pose surges the strength
// much higher for a dramatic blowing effect.
// ---------------------------------------------------------------------------
function applyAmbientWind(t) {
  const manager = currentVrm?.springBoneManager;
  if (!manager?.joints) return;
  try {
    const boosted = behavior === 'wind';

    // turbulence: several offset sines so gusts swell and fade unevenly
    const gust = (Math.sin(t * 0.8) * 0.5 + Math.sin(t * 1.9 + 1.0) * 0.3 + Math.sin(t * 3.7 + 2.0) * 0.2);
    const dirX = Math.sin(t * 1.6) * 0.6 + gust * 0.3;
    const dirZ = Math.cos(t * 1.1) * 0.4 + gust * 0.2;

    // baseline breeze keeps a little motion; gust pose pushes far harder
    const basePower = 0.25;                              // gentle constant breeze
    const swing = (0.5 + 0.5 * gust);                    // 0..1 turbulence envelope
    const power = boosted
      ? basePower + 1.6 * swing                          // strong, visibly blowing
      : basePower + 0.35 * swing;                        // subtle ambient sway

    manager.joints.forEach((joint) => {
      const s = joint.settings;
      if (!s) return;
      if (s._origGravityPower === undefined) {
        s._origGravityPower = (s.gravityPower !== undefined) ? s.gravityPower : 0;
      }
      // aim the force mostly sideways (wind) with the model's own gravity still
      // pulling down a bit, then set how hard it pushes
      if (s.gravityDir) s.gravityDir.set(dirX, -0.5, dirZ).normalize();
      if (s.gravityPower !== undefined) s.gravityPower = s._origGravityPower + power;
    });
  } catch (e) { /* spring bone API differs on this model/version — safe to skip */ }
}



// =============================================================================
// Blink cycle + expressions + lip-sync
// =============================================================================
let currentExpression = 'neutral';
let nextBlinkAt = 0;
let blinkUntil = 0;
let flashExpressionUntil = 0;
let flashExpressionName = null;

const EXPRESSION_NAMES = ['happy', 'relaxed', 'sad', 'angry', 'surprised'];

function applyExpression(name) {
  const em = currentVrm?.expressionManager;
  if (!em) return;
  EXPRESSION_NAMES.forEach((n) => em.setValue(n, 0));
  if (name && name !== 'neutral') em.setValue(name, 1);
}

function flashExpression(name, ms) {
  flashExpressionName = name;
  flashExpressionUntil = performance.now() + ms;
}

function updateBlinkAndExpression(t) {
  const em = currentVrm?.expressionManager;
  if (!em) return;

  // periodic auto-blink
  if (t > nextBlinkAt && blinkUntil < t) {
    blinkUntil = t + 0.12;
    nextBlinkAt = t + 2.2 + Math.random() * 3.0;
  }
  const blinkValue = asleep ? 1 : (t < blinkUntil ? 1 : 0);
  em.setValue('blink', blinkValue);

  // temporary "reaction" expression overrides the selected one briefly
  if (flashExpressionName && performance.now() < flashExpressionUntil) {
    EXPRESSION_NAMES.forEach((n) => em.setValue(n, n === flashExpressionName ? 1 : 0));
  } else if (flashExpressionName) {
    flashExpressionName = null;
    applyExpression(currentExpression);
  }

  // lip-sync: drive the 'aa' viseme (fallback to 'a') from the synthetic
  // amplitude envelope produced while speaking (see speak() below)
  const mouthValue = speaking ? mouthEnvelope : 0;
  if (em.setValue) {
    try { em.setValue('aa', mouthValue); } catch (e) { /* preset not present on this model */ }
  }
}

// =============================================================================
// Auto-sleep after inactivity
// =============================================================================
const SLEEP_AFTER_MS = 5 * 60 * 1000; // 5 minutes idle
function checkAutoSleep() {
  if (!autoSleepSwitch.get()) return;
  if (!asleep && performance.now() - lastInteractionTime > SLEEP_AFTER_MS) {
    asleep = true;
    showBubble('*falls asleep*');
  }
}
['mousemove', 'mousedown', 'keydown'].forEach((evt) =>
  window.addEventListener(evt, () => { lastInteractionTime = performance.now(); })
);

// =============================================================================
// Speech bubble + idle chatter (now contextual via AI when a key is set)
// =============================================================================
const fallbackLines = [
  "Don't forget to take a break~",
  'Compiling... or am I just thinking?',
  'Nice desktop today.',
  "I'm watching the cursor. No reason.",
  '*stretches*',
];

function showBubble(text) {
  bubble.textContent = text;
  bubble.style.left = (window.innerWidth / 2 + 60) + 'px';
  bubble.style.top = (window.innerHeight / 2 - 220) + 'px';
  bubble.classList.add('show');
  clearTimeout(showBubble._t);
  showBubble._t = setTimeout(() => bubble.classList.remove('show'), 4200);
}

let aiProvider = 'anthropic';
let lastClipboardSnippet = '';

window.companionAPI?.onClipboardChanged((text) => { lastClipboardSnippet = text; });
window.companionAPI?.onCpuWarning((pct) => {
  if (cpuWarnSwitch.get()) showBubble(`Heads up — CPU load is around ${pct}%.`);
});

async function generateChatterLine() {
  const all = (await window.companionAPI?.getAllSettings?.()) || {};
  const apiKeys = all.apiKeys || {};
  if (aiProvider !== 'ollama' && !apiKeys[aiProvider]) {
    return fallbackLines[Math.floor(Math.random() * fallbackLines.length)];
  }
  const hour = new Date().getHours();
  const timeOfDay = hour < 6 ? 'late night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const clipboardNote = clipboardSwitch.get() && lastClipboardSnippet
    ? `The user's clipboard recently contained: "${lastClipboardSnippet.slice(0, 200)}".`
    : '';
  const system = `You are a small, cheerful desktop companion character. Say one short (under 15 words), casual, in-character idle remark. It is currently the ${timeOfDay}. ${clipboardNote} Do not use quotation marks.`;

  const res = await window.companionAPI?.aiChat(aiProvider, $('modelInput').value, [
    { role: 'user', content: 'Say something idle and in-character.' },
  ], system);

  if (res?.ok && res.text) return res.text;
  return fallbackLines[Math.floor(Math.random() * fallbackLines.length)];
}

function queueChatter() {
  clearTimeout(queueChatter._t);
  queueChatter._t = setTimeout(async () => {
    if (chatterSwitch.get() && !asleep) {
      const line = await generateChatterLine();
      showBubble(line);
      speak(line);
    }
    queueChatter();
  }, 9000 + Math.random() * 9000);
}

// =============================================================================
// Chat input, voice input, and TTS-driven lip-sync
// =============================================================================
const chatHistory = [];
let speaking = false;
let mouthEnvelope = 0;
let voiceVolume = 0.8;
let audioCtx = null;

// Real API TTS path: fetch audio bytes from the main process, decode them,
// and run a live AnalyserNode so the mouth envelope tracks ACTUAL loudness —
// true amplitude lip-sync, not the word-timing approximation. Falls back to
// browser speech synthesis when real TTS is off or unavailable.
async function speakReal(text) {
  const res = await window.companionAPI?.ttsSpeak(text);
  if (!res?.ok) {
    console.warn('TTS failed, falling back to browser speech:', res?.error);
    return false;
  }
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const bytes = Uint8Array.from(atob(res.audio), (c) => c.charCodeAt(0));
    const buffer = await audioCtx.decodeAudioData(bytes.buffer);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.value = muteSwitch.get() ? 0 : voiceVolume;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);

    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(audioCtx.destination);

    speaking = true;
    const tick = () => {
      if (!speaking) return;
      analyser.getByteTimeDomainData(data);
      // RMS amplitude of the waveform → mouth openness
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      mouthEnvelope = Math.min(1, Math.sqrt(sum / data.length) * 3.2);
      requestAnimationFrame(tick);
    };
    source.onended = () => { speaking = false; mouthEnvelope = 0; };
    source.start();
    tick();
    return true;
  } catch (e) {
    console.warn('Audio decode/playback failed, falling back:', e);
    return false;
  }
}

function speakBrowser(text) {
  if (muteSwitch.get() || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.volume = voiceVolume;
  utter.pitch = 1.15;
  utter.rate = 1.02;
  speaking = true;
  // Word-boundary approximation when no real audio buffer is available.
  utter.onboundary = () => {
    mouthEnvelope = 0.55 + Math.random() * 0.45;
    setTimeout(() => { mouthEnvelope = 0.15; }, 90);
  };
  utter.onend = utter.onerror = () => { speaking = false; mouthEnvelope = 0; };
  window.speechSynthesis.speak(utter);
}

async function speak(text) {
  if (muteSwitch.get()) return;
  const settings = (await window.companionAPI?.getAllSettings?.()) || {};
  if (settings.ttsEnabled) {
    const ok = await speakReal(text);
    if (ok) return;
  }
  speakBrowser(text);
}

async function sendChat(text, opts = {}) {
  if (!text.trim() && !opts.image) return;
  chatHistory.push({ role: 'user', content: text || 'What do you see on my screen?' });
  if (chatHistory.length > 12) chatHistory.splice(0, chatHistory.length - 12);

  showBubble('...');
  const all = (await window.companionAPI?.getAllSettings?.()) || {};
  const apiKeys = all.apiKeys || {};
  const usingOllama = aiProvider === 'ollama';
  if (!usingOllama && !apiKeys[aiProvider]) {
    showBubble('Add an API key in Settings → AI to let me actually reply.');
    return;
  }

  // Persistent memory: prepend a compact recap of remembered past turns so the
  // companion has continuity across restarts.
  let memoryNote = '';
  if (all.memoryEnabled) {
    const mem = (await window.companionAPI?.memoryGet?.()) || [];
    if (mem.length) {
      const recap = mem.slice(-8).map((m) => `${m.role}: ${m.content}`).join(' | ');
      memoryNote = ` Things you remember about past chats with this user: ${recap}.`;
    }
  }

  const system = `You are a small, friendly desktop companion character. Reply in 1-3 short, casual sentences.${memoryNote}`;
  const res = await window.companionAPI?.aiChat(aiProvider, $('modelInput').value, chatHistory, system, opts.image);

  if (res?.ok) {
    chatHistory.push({ role: 'assistant', content: res.text });
    showBubble(res.text);
    speak(res.text);
    // persist this exchange into long-term memory
    if (all.memoryEnabled) {
      const mem = (await window.companionAPI?.memoryGet?.()) || [];
      mem.push({ role: 'user', content: (text || '[looked at screen]').slice(0, 160) });
      mem.push({ role: 'assistant', content: res.text.slice(0, 160) });
      // cap to last 40 entries so it doesn't grow unbounded
      await window.companionAPI?.memorySet(mem.slice(-40));
    }
  } else {
    showBubble(`(error: ${res?.error || 'no response'})`);
  }
}

// Vision: capture the screen and ask the companion to comment on it.
async function lookAtScreen() {
  showBubble('*looks at your screen*');
  const cap = await window.companionAPI?.visionCapture();
  if (!cap?.ok) { showBubble(`(couldn't capture screen: ${cap?.error || 'unknown'})`); return; }
  await sendChat('What do you see on my screen? React briefly and in character.', { image: cap.image });
}

$('sendBtn').addEventListener('click', () => {
  const input = $('chatInput');
  sendChat(input.value);
  input.value = '';
});
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('sendBtn').click();
});

// Voice input via the browser's built-in Speech Recognition. Honest scope
// note: this uses the OS/Chromium speech service (online, like Chrome's
// dictation), not a bundled offline Whisper model — adding real Whisper
// would mean shipping/loading a multi-hundred-MB model file.
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = $('micBtn');
if (SpeechRecognitionImpl) {
  const recognition = new SpeechRecognitionImpl();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  let listening = false;
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    $('chatInput').value = text;
    sendChat(text);
  };
  recognition.onend = () => { listening = false; micBtn.classList.remove('listening'); };
  recognition.onerror = () => { listening = false; micBtn.classList.remove('listening'); };

  micBtn.addEventListener('click', () => {
    if (listening) { recognition.stop(); return; }
    listening = true;
    micBtn.classList.add('listening');
    recognition.start();
  });
} else {
  micBtn.disabled = true;
  micBtn.title = 'Voice input not supported in this build of Electron';
}

// Vision button: only acts when vision is enabled in settings.
$('visionBtn').addEventListener('click', async () => {
  const settings = (await window.companionAPI?.getAllSettings?.()) || {};
  if (!settings.visionEnabled) { showBubble('Enable Vision in Settings → AI first.'); return; }
  const btn = $('visionBtn');
  btn.classList.add('active');
  await lookAtScreen();
  btn.classList.remove('active');
});

// =============================================================================
// Boot: restore persisted settings, then load character list + last character
// =============================================================================
(async () => {
  const settings = (await window.companionAPI?.getAllSettings?.()) || {};

  if (settings.size) { $('sizeSlider').value = settings.size; $('sizeVal').textContent = settings.size + '%'; }
  if (settings.swaySpeed) {
    $('swaySlider').value = settings.swaySpeed;
    swaySpeed = settings.swaySpeed / 100;
    $('swayVal').textContent = swaySpeed.toFixed(1) + 'x';
  }
  if (settings.behavior) { $('behaviorSelect').value = settings.behavior; behavior = settings.behavior; }
  if (settings.expression) { $('expressionSelect').value = settings.expression; currentExpression = settings.expression; }
  if (typeof settings.volume === 'number') {
    $('volSlider').value = settings.volume; $('volVal').textContent = settings.volume + '%'; voiceVolume = settings.volume / 100;
  }
  if (settings.aiProvider) { $('providerSelect').value = settings.aiProvider; aiProvider = settings.aiProvider; }
  if (settings.aiModel) $('modelInput').value = settings.aiModel;

  chatterSwitch.set(settings.chatterEnabled !== false);
  autoSleepSwitch.set(settings.autoSleep !== false);
  cpuWarnSwitch.set(settings.cpuWarnEnabled !== false);
  minimalSwitch.set(!!settings.minimalMode);
  document.body.classList.toggle('minimal', !!settings.minimalMode);

  // animation feature flags
  features.eyeTracking = settings.eyeTracking !== false;
  features.idleVariation = settings.idleVariation !== false;
  features.physicsReactions = settings.physicsReactions !== false;
  features.walk = !!settings.walkEnabled;
  $('toggleEyeTracking').classList.toggle('on', features.eyeTracking);
  $('toggleIdleVariation').classList.toggle('on', features.idleVariation);
  $('togglePhysics').classList.toggle('on', features.physicsReactions);
  walkSwitch.set(features.walk);

  // AI feature toggles + provider UI
  $('toggleMemory').classList.toggle('on', !!settings.memoryEnabled);
  $('toggleVision').classList.toggle('on', !!settings.visionEnabled);
  ttsSwitch.set(!!settings.ttsEnabled);
  $('ttsRow').style.display = settings.ttsEnabled ? 'block' : 'none';
  if (settings.ttsProvider) $('ttsProviderSelect').value = settings.ttsProvider;
  if (settings.ttsVoice) $('ttsVoiceInput').value = settings.ttsVoice;
  if (settings.ollamaUrl) $('ollamaUrlInput').value = settings.ollamaUrl;
  if (settings.ollamaModel) $('ollamaModelInput').value = settings.ollamaModel;
  if (settings.apiKeys?.elevenlabs) $('elevenKeyInput').value = settings.apiKeys.elevenlabs;

  // reflect the actual OS login-item state, not just our stored guess
  const startupOn = await window.companionAPI?.getStartup?.();
  startupSwitch.set(!!startupOn);
  muteSwitch.set(!!settings.muted);
  clipboardSwitch.set(!!settings.watchClipboard);
  topSwitch.set(settings.alwaysOnTop !== false);
  clickThroughSwitch.set(!!settings.clickThrough);
  clickThroughActive = !!settings.clickThrough;
  if (settings.watchClipboard) window.companionAPI?.setWatchClipboard(true);

  updateProviderUI();
  await loadApiKeyIntoField();

  const list = await refreshCharacterList(settings.characterId);
  const initial = list.find((c) => c.id === settings.characterId) || list.find((c) => c.source === 'bundled') || list[0];
  if (initial) {
    characterSelect.value = initial.id;
    loadCharacterById(initial.id);
  } else {
    loadingEl.style.display = 'none';
  }
})();

// =============================================================================
// Procedural eye look-at — moves the lookAt target toward the cursor so the
// eyes track independently of the head.
// =============================================================================
const _eyeTmp = new THREE.Vector3();
function updateEyeLookAt(dt) {
  if (!currentVrm?.lookAt) return;
  if (!features.eyeTracking || asleep) {
    // park the target straight ahead so eyes recenter
    _eyeTmp.set(0, 1.3, 5);
  } else {
    // place target in front of the head, offset by cursor position
    const headPos = currentVrm.humanoid?.getNormalizedBoneNode('head')?.getWorldPosition(new THREE.Vector3())
      || new THREE.Vector3(0, 1.3, 0);
    _eyeTmp.set(headPos.x + cursorX * 1.4, headPos.y - cursorY * 1.0, headPos.z + 4);
  }
  lookAtTarget.position.lerp(_eyeTmp, 1 - Math.exp(-10 * dt));
}

// =============================================================================
// Idle variation — every 20-35s, if the user is on plain "idle", briefly drift
// to a relaxed alternate pose then back, so a watched companion doesn't loop
// one identical motion forever.
// =============================================================================
const IDLE_ALTERNATES = ['leanback', 'look', 'handsonhips', 'crossarms', 'stretch'];
let idleVariationUntil = 0;
let idleVariationNext = performance.now() + 22000;
let savedBehaviorForVariation = null;

function updateIdleVariation() {
  if (!features.idleVariation || asleep) return;
  const now = performance.now();
  if (behavior === 'idle' && now > idleVariationNext && now > idleVariationUntil) {
    savedBehaviorForVariation = 'idle';
    const pick = IDLE_ALTERNATES[Math.floor(Math.random() * IDLE_ALTERNATES.length)];
    setBehavior(pick);
    idleVariationUntil = now + 3500 + Math.random() * 2500;
    idleVariationNext = now + 22000 + Math.random() * 13000;
  } else if (savedBehaviorForVariation && now > idleVariationUntil) {
    // only auto-revert if the user hasn't manually changed behavior meanwhile
    if (IDLE_ALTERNATES.includes(behavior)) setBehavior('idle');
    savedBehaviorForVariation = null;
  }
}

// =============================================================================
// Walk / wander — the window drifts on its own toward waypoints along the
// screen edges, and walks to the cursor when you summon it. Uses the same
// per-frame window move IPC as dragging.
// =============================================================================
let walkTargetScreen = null;     // {x,y} in screen coords, or null
let walkRepathAt = 0;
function pickWanderWaypoint() {
  // a random point near a screen edge
  const margin = 60;
  const w = window.screen.availWidth || 1920;
  const h = window.screen.availHeight || 1080;
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) return { x: Math.random() * w, y: margin };
  if (edge === 1) return { x: w - margin, y: Math.random() * h };
  if (edge === 2) return { x: Math.random() * w, y: h - margin };
  return { x: margin, y: Math.random() * h };
}
function updateWalk(dt, t) {
  if (!features.walk || asleep || dragging) { if (behavior === 'walk') setBehavior('idle'); return; }
  const now = performance.now();
  if (!walkTargetScreen || now > walkRepathAt) {
    walkTargetScreen = pickWanderWaypoint();
    walkRepathAt = now + 6000 + Math.random() * 6000;
  }
  // approximate our own window-center screen position from cursor broadcasts is
  // unreliable; instead nudge the window a small step toward the target each
  // frame via relative moves and let snapping/edges bound it.
  const stepX = Math.sign(walkTargetScreen.x - (window.screenX + window.innerWidth / 2));
  const stepY = Math.sign(walkTargetScreen.y - (window.screenY + window.innerHeight / 2));
  const speed = 1.4;
  window.companionAPI?.dragWindow(stepX * speed, stepY * speed);
  if (behavior !== 'walk') setBehavior('walk');
  // little leg bob so it reads as walking (handled by the 'walk' pose)
}

// summon to cursor: walk toward the current cursor screen position
function summonToCursor() {
  if (!features.walk) return;
  // cursorX/Y are normalized [-1,1] around window center; convert to a screen
  // waypoint roughly in that direction, a chunk of the screen away.
  const w = window.screen.availWidth || 1920;
  const h = window.screen.availHeight || 1080;
  walkTargetScreen = {
    x: Math.min(w, Math.max(0, window.screenX + window.innerWidth / 2 + cursorX * w * 0.5)),
    y: Math.min(h, Math.max(0, window.screenY + window.innerHeight / 2 + cursorY * h * 0.5)),
  };
  walkRepathAt = performance.now() + 8000;
}

// =============================================================================
// Drag-velocity physics — when you fling the window, the character leans
// opposite the motion (inertia) and recovers with a springy wobble; spring-bone
// hair already lags naturally, this adds body lean on top.
// =============================================================================
let dragVelX = 0, dragVelY = 0;
let leanX = 0, leanZ = 0, leanVX = 0, leanVZ = 0;
function pushDragVelocity(dx, dy) {
  if (!features.physicsReactions) return;
  dragVelX = dx; dragVelY = dy;
}
function updatePhysicsLean(dt) {
  if (!features.physicsReactions) { leanX = leanZ = 0; return; }
  // target lean is proportional to recent drag velocity (opposite direction)
  const targetZ = THREE.MathUtils.clamp(-dragVelX * 0.012, -0.5, 0.5);
  const targetX = THREE.MathUtils.clamp(dragVelY * 0.012, -0.5, 0.5);
  // critically-damped-ish spring toward target, then target decays to 0
  const k = 90, c = 14;
  leanVZ += (-(leanZ - targetZ) * k - leanVZ * c) * dt;
  leanVX += (-(leanX - targetX) * k - leanVX * c) * dt;
  leanZ += leanVZ * dt;
  leanX += leanVX * dt;
  dragVelX *= Math.exp(-6 * dt);
  dragVelY *= Math.exp(-6 * dt);
}

// =============================================================================
// Animation loop
// =============================================================================
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  checkAutoSleep();
  updateIdleVariation();
  updateWalk(dt, t);
  updatePhysicsLean(dt);

  if (currentVrm) {
    currentVrm.update(dt);
    applyPoseSmoothed(dt, t);
    // apply drag-physics lean on top of the pose (spine + chest)
    const spine = currentVrm.humanoid?.getNormalizedBoneNode('spine');
    const chest = currentVrm.humanoid?.getNormalizedBoneNode('chest');
    if (spine) { spine.rotation.x += leanX * 0.6; spine.rotation.z += leanZ * 0.6; }
    if (chest) { chest.rotation.x += leanX * 0.4; chest.rotation.z += leanZ * 0.4; }
    updateEyeLookAt(dt);
    updateBlinkAndExpression(t);
    applyAmbientWind(t); // hair/cloth physics get a constant gentle breeze, always
  }

  renderer.render(scene, camera);
}
animate();
