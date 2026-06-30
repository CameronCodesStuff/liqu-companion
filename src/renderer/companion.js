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

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.setClearColor(0x000000, 0);

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, stage.clientWidth / stage.clientHeight, 0.05, 50);
camera.position.set(0, 1.3, 3.2);

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
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  if (currentVrm) frameCamera(currentVrm);
});

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

const dragHandle = $('dragHandle');
let dragging = false, lastX = 0, lastY = 0;

function beginDrag(e) {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  const rect = stage.getBoundingClientRect();
  stage.style.bottom = 'auto';
  stage.style.right = 'auto';
  stage.style.left = rect.left + 'px';
  stage.style.top = rect.top + 'px';
}
dragHandle.addEventListener('mousedown', beginDrag);

let pressStartX = 0, pressStartY = 0, pressing = false, dragStarted = false;
renderer.domElement.addEventListener('mousedown', (e) => {
  pressing = true; dragStarted = false;
  pressStartX = e.clientX; pressStartY = e.clientY;
});
window.addEventListener('mousemove', (e) => {
  if (pressing && !dragStarted) {
    if (Math.hypot(e.clientX - pressStartX, e.clientY - pressStartY) > 5) {
      dragStarted = true;
      beginDrag({ clientX: pressStartX, clientY: pressStartY });
    }
  }
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  stage.style.left = (parseFloat(stage.style.left) + dx) + 'px';
  stage.style.top = (parseFloat(stage.style.top) + dy) + 'px';
  pushDragVelocity(dx, dy);
});
window.addEventListener('mouseup', () => {
  pressing = false;
  if (!dragging) return;
  dragging = false;
});

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
    panel.style.left = (startLeft + (e.clientX - sx)) + 'px';
    panel.style.top = (startTop + (e.clientY - sy)) + 'px';
  });
  window.addEventListener('mouseup', () => { pdrag = false; });
})();

let charClickThrough = false;
const interactiveEls = [$('gear'), $('panel'), $('chatBar'), $('dragHandle')];
interactiveEls.forEach((el) => {
  el.addEventListener('mouseenter', () => {
    window.companionAPI?.setIgnoreMouse(false);
  });
  el.addEventListener('mouseleave', () => {
    window.companionAPI?.setIgnoreMouse(true);
  });
});
stage.addEventListener('mouseenter', () => {
  if (!charClickThrough) window.companionAPI?.setIgnoreMouse(false);
});
stage.addEventListener('mouseleave', () => {
  window.companionAPI?.setIgnoreMouse(true);
});

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
  charClickThrough = on;
}, 'clickThrough');

window.companionAPI?.onAlwaysOnTopChanged((v) => topSwitch.set(v));

const chatterSwitch = bindSwitch('toggleChatter', null, 'chatterEnabled');
const idleVoiceSwitch = bindSwitch('toggleIdleVoice', null, 'idleVoiceEnabled');
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

bindSwitch('toggleEyeTracking', (on) => { features.eyeTracking = on; }, 'eyeTracking');
bindSwitch('toggleIdleVariation', (on) => { features.idleVariation = on; }, 'idleVariation');
bindSwitch('togglePhysics', (on) => { features.physicsReactions = on; }, 'physicsReactions');

const wanderSwitch = $('toggleWander');
const followSwitch = $('toggleFollow');
function syncMoveMode() {
  if (followSwitch.classList.contains('on')) setMovementMode('follow');
  else if (wanderSwitch.classList.contains('on')) setMovementMode('wander');
  else setMovementMode('off');
}
wanderSwitch.addEventListener('click', () => {
  const on = !wanderSwitch.classList.contains('on');
  wanderSwitch.classList.toggle('on', on);
  if (on) followSwitch.classList.remove('on');
  window.companionAPI?.setSetting('moveMode', followSwitch.classList.contains('on') ? 'follow' : on ? 'wander' : 'off');
  syncMoveMode();
});
followSwitch.addEventListener('click', () => {
  const on = !followSwitch.classList.contains('on');
  followSwitch.classList.toggle('on', on);
  if (on) wanderSwitch.classList.remove('on');
  window.companionAPI?.setSetting('moveMode', on ? 'follow' : wanderSwitch.classList.contains('on') ? 'wander' : 'off');
  syncMoveMode();
});

bindSwitch('toggleMemory', null, 'memoryEnabled');
bindSwitch('toggleVision', null, 'visionEnabled');
const ttsSwitch = bindSwitch('toggleTTS', (on) => {
  $('ttsRow').style.display = on ? 'block' : 'none';
  $('browserVoiceRow').style.display = on ? 'none' : 'block';
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

$('comeHereBtn').addEventListener('click', () => {
  setMovementMode('follow');

  setTimeout(() => {
    if (!followSwitch.classList.contains('on')) syncMoveMode();
  }, 5000);
});
$('clearMemoryBtn').addEventListener('click', async () => {
  await window.companionAPI?.memoryClear();
  showBubble('Memory cleared.');
});

const PROVIDER_MODELS = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-1', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
  google: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'],
  ollama: ['llama3.2', 'llama3.2-vision', 'llava', 'mistral', 'qwen2.5'],
};

function populateModelList(provider, keepValue) {
  const dl = $('modelList');
  dl.innerHTML = '';
  (PROVIDER_MODELS[provider] || []).forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    dl.appendChild(opt);
  });
  if (!keepValue) {
    const def = (PROVIDER_MODELS[provider] || [])[0] || '';
    if (provider === 'ollama') {
      $('ollamaModelInput').value = $('ollamaModelInput').value || def;
      window.companionAPI?.setSetting('ollamaModel', $('ollamaModelInput').value);
    } else {
      $('modelInput').value = def;
      window.companionAPI?.setSetting('aiModel', def);
    }
  }
}

function updateProviderUI() {
  const isOllama = aiProvider === 'ollama';
  $('apiKeyRow').style.display = isOllama ? 'none' : 'block';
  $('ollamaRow').style.display = isOllama ? 'block' : 'none';
  $('modelInput').parentElement.style.display = isOllama ? 'none' : 'block';
}
$('providerSelect').addEventListener('change', async (e) => {
  aiProvider = e.target.value;
  window.companionAPI?.setSetting('aiProvider', aiProvider);
  updateProviderUI();
  populateModelList(aiProvider, false);
  await loadApiKeyIntoField();
});
$('modelInput').addEventListener('change', (e) => window.companionAPI?.setSetting('aiModel', e.target.value));

async function saveTextApiKey() {
  const all = (await window.companionAPI?.getAllSettings?.()) || {};
  const apiKeys = all.apiKeys || {};
  apiKeys[aiProvider] = $('apiKeyInput').value;
  await window.companionAPI?.setSetting('apiKeys', apiKeys);
  $('apiKeyStatus').textContent = $('apiKeyInput').value ? '✓ Key set and saved.' : 'Key cleared.';
}
$('setApiKeyBtn').addEventListener('click', saveTextApiKey);
$('apiKeyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveTextApiKey(); });

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

const TTS_VOICES = {
  openai: [
    { id: 'nova', label: 'Nova (bright female)' },
    { id: 'shimmer', label: 'Shimmer (soft female)' },
    { id: 'coral', label: 'Coral (warm female)' },
    { id: 'alloy', label: 'Alloy (neutral)' },
    { id: 'fable', label: 'Fable (expressive)' },
    { id: 'sage', label: 'Sage (gentle)' },
    { id: 'ballad', label: 'Ballad (storyteller)' },
    { id: 'ash', label: 'Ash (calm)' },
    { id: 'echo', label: 'Echo (warm male)' },
    { id: 'onyx', label: 'Onyx (deep male)' },
  ],
  elevenlabs: [
    { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella (soft, high — anime-like)' },
    { id: 'jBpfAIEqvSfVk9B0CIjw', label: 'Gigi (young, bright — anime-like)' },
    { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel (calm female)' },
    { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi (strong female)' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli (young female)' },
    { id: 'jsCqWAovK2LkecY7zXl4', label: 'Freya (warm female)' },
    { id: 'oWAxZDx7w5VEj9dCyTzz', label: 'Grace (gentle female)' },
    { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte (sweet female)' },
    { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni (warm male)' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh (deep male)' },
    { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (narration male)' },
    { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold (strong male)' },
  ],
};

function populateVoiceList(provider, savedVoice) {
  const sel = $('ttsVoiceSelect');
  sel.innerHTML = '';
  (TTS_VOICES[provider] || []).forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.label;
    sel.appendChild(opt);
  });
  const list = TTS_VOICES[provider] || [];
  if (savedVoice && list.some((v) => v.id === savedVoice)) {
    sel.value = savedVoice;
    $('ttsVoiceCustom').value = '';
  } else if (savedVoice) {
    $('ttsVoiceCustom').value = savedVoice;
  } else {
    sel.value = list[0]?.id || '';
    window.companionAPI?.setSetting('ttsVoice', sel.value);
  }
  $('elevenKeyRow').style.display = provider === 'elevenlabs' ? 'block' : 'none';
}

$('ttsProviderSelect').addEventListener('change', async (e) => {
  const prov = e.target.value;
  await window.companionAPI?.setSetting('ttsProvider', prov);
  populateVoiceList(prov, null);
});
$('ttsVoiceSelect').addEventListener('change', (e) => {
  $('ttsVoiceCustom').value = '';
  window.companionAPI?.setSetting('ttsVoice', e.target.value);
});
$('ttsVoiceCustom').addEventListener('change', (e) => {
  if (e.target.value.trim()) window.companionAPI?.setSetting('ttsVoice', e.target.value.trim());
});

async function saveVoiceKey() {
  const all = (await window.companionAPI?.getAllSettings?.()) || {};
  const apiKeys = all.apiKeys || {};
  apiKeys.elevenlabs = $('elevenKeyInput').value;
  await window.companionAPI?.setSetting('apiKeys', apiKeys);
  $('voiceKeyStatus').textContent = $('elevenKeyInput').value ? '✓ Voice key set and saved.' : 'Key cleared.';
}
$('setVoiceKeyBtn').addEventListener('click', saveVoiceKey);
$('elevenKeyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveVoiceKey(); });

$('testVoiceBtn').addEventListener('click', async () => {
  $('testVoiceBtn').textContent = 'Speaking…';
  await speakReal('Hi! This is how I sound.');
  $('testVoiceBtn').textContent = 'Test voice';
});

function populateBrowserVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  const sel = $('browserVoiceSelect');
  sel.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '(system default)';
  sel.appendChild(defaultOpt);
  voices.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(opt);
  });
}
if ('speechSynthesis' in window) {
  populateBrowserVoices();
  window.speechSynthesis.onvoiceschanged = populateBrowserVoices;
}
$('browserVoiceSelect').addEventListener('change', (e) => {
  window.companionAPI?.setSetting('browserVoice', e.target.value);
  speakBrowser('Hello!');
});

async function loadApiKeyIntoField() {
  const all = (await window.companionAPI?.getAllSettings?.()) || {};
  const apiKeys = all.apiKeys || {};
  $('apiKeyInput').value = apiKeys[aiProvider] || '';
  $('apiKeyStatus').textContent = apiKeys[aiProvider] ? '✓ Key set and saved.' : 'No key set yet.';
}

const ARM_DOWN = 1.25;

function armZ(side, lift) {

  const z = ARM_DOWN * (1 - lift);
  return side === 'left' ? z : -z;
}

const BASE_POSE = {
  chest: { x: 0.02, y: 0.01, z: 0.01 },
  spine: { x: 0.015, y: 0.02, z: 0.02 },
  hips: { x: 0, y: 0, z: -0.03 },
  head: { x: 0.01, y: -0.02, z: 0.015 },

  leftUpperArm: { x: 0.14, y: 0.04, z: armZ('left', 0.16) },
  rightUpperArm: { x: 0.12, y: -0.03, z: armZ('right', 0.13) },
  leftLowerArm: { x: 0.05, y: 0.28, z: 0.4 },
  rightLowerArm: { x: 0.04, y: -0.24, z: -0.34 },
  leftHand: { x: 0.05, y: 0.06, z: 0.16 },
  rightHand: { x: 0.04, y: -0.05, z: -0.13 },
  leftUpperLeg: { x: 0.02, y: 0.01, z: 0.05 },
  rightUpperLeg: { x: -0.04, y: -0.01, z: -0.02 },
  leftLowerLeg: { x: 0.06, y: 0, z: 0 },
  rightLowerLeg: { x: 0.12, y: 0, z: 0 },
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

const lookAtTarget = new THREE.Object3D();

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

function armLift(targets, side, lift, fwd = 0, bend = 0) {
  const upper = side === 'left' ? 'leftUpperArm' : 'rightUpperArm';
  const lower = side === 'left' ? 'leftLowerArm' : 'rightLowerArm';
  setAbs(targets, upper, fwd, 0, armZ(side, lift));

  setAbs(targets, lower, 0, 0, side === 'left' ? bend : -bend);
}

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

      armLift(targets, 'right', 0.55 + 0.85 * raise, 0.1 * raise, 1.0 * raise);
      add(targets, 'rightLowerArm', 0, 0, wiggle);
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

      armLift(targets, 'right', 0.5 + 0.5 * d, 0.2 * d, 1.9 * d);
    },
  },

  clap: {
    label: 'Clap',
    fn: (t, el, targets) => {
      const clapPhase = Math.abs(Math.sin(el * 6));

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

      armLift(targets, 'left', 0.25 * d, 0.1 * d, 0.7 * d);
      armLift(targets, 'right', 0.25 * d, 0.1 * d, 0.7 * d);
      add(targets, 'head', 0.05 * d, 0, 0);
    },
  },

  point: {
    label: 'Point forward',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);

      armLift(targets, 'right', 0.85 * d + 0.06 * (1 - d), 0.9 * d, 0);
    },
  },

  peace: {
    label: 'Peace sign',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);

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

      armLift(targets, 'right', 0.5 + 0.5 * d, 0.3 * d, 1.6 * d);
      add(targets, 'head', -0.2 * d, 0, 0);
    },
  },

  facepalm: {
    label: 'Facepalm',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);

      armLift(targets, 'right', 0.5 + 0.55 * d, 0.5 * d, 2.0 * d);
      add(targets, 'head', 0.2 * d, 0, 0.1 * d);
    },
  },

  crossarms: {
    label: 'Arms crossed',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);

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

      armLift(targets, 'right', 0.5 + 0.6 * d, 0.3 * d, 1.7 * d);
    },
  },

  determined: {
    label: 'Determined stance',
    fn: (t, el, targets) => {
      const d = Math.min(el / 0.3, 1);

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
      const phase = el * 8;
      const stride = Math.sin(phase);
      const lift = Math.cos(phase);
      add(targets, 'spine', 0.08, stride * 0.06, 0);
      add(targets, 'chest', 0.04, 0, 0);
      add(targets, 'hips', 0, -stride * 0.08, 0);
      add(targets, 'leftUpperLeg', stride * 0.55, 0, 0);
      add(targets, 'rightUpperLeg', -stride * 0.55, 0, 0);
      add(targets, 'leftLowerLeg', Math.max(0, lift) * 0.8, 0, 0);
      add(targets, 'rightLowerLeg', Math.max(0, -lift) * 0.8, 0, 0);
      armLift(targets, 'left', 0.08, -stride * 0.35, 0.3);
      armLift(targets, 'right', 0.08, stride * 0.35, 0.3);
      add(targets, 'head', 0.03, stride * 0.04, 0);
      modelGroup.position.y = Math.abs(Math.sin(phase)) * 0.015;
    },
  },
};

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
  if (def.freeze) return null;

  const amp = asleep ? 0.4 : 1;

  const breathe = (Math.sin(t * 1.1 * swaySpeed) + Math.sin(t * 1.7 * swaySpeed + 0.6) * 0.4) * 0.022 * amp;
  const sway = (Math.sin(t * 0.45 * swaySpeed) + Math.sin(t * 0.8 * swaySpeed + 1.1) * 0.35) * 0.06 * amp;
  const weight = Math.sin(t * 0.16 * swaySpeed) * 0.1 * amp;
  const weightFast = Math.sin(t * 0.33 * swaySpeed + 0.7) * 0.03 * amp;
  const drift = Math.sin(t * 0.7 + 1.3) * 0.03 * amp;
  const driftSlow = Math.sin(t * 0.27 + 2.4) * 0.04 * amp;
  const microL = (Math.sin(t * 1.9 + 0.5) + Math.sin(t * 3.1 + 1.7) * 0.4) * 0.018 * amp;
  const microR = (Math.sin(t * 1.7 + 2.1) + Math.sin(t * 2.9 + 0.3) * 0.4) * 0.018 * amp;

  add(targets, 'chest', breathe * 0.7, sway * 0.15, breathe + weightFast * 0.3);
  add(targets, 'spine', breathe * 0.35, sway * 0.45, weight * 0.55);
  add(targets, 'hips', weightFast * 0.4, sway * 0.1, weight);

  add(targets, 'leftUpperLeg', 0, 0, weight * 0.5 - weightFast * 0.2);
  add(targets, 'rightUpperLeg', 0, 0, weight * 0.5 + weightFast * 0.2);
  add(targets, 'leftLowerLeg', Math.max(0, -weight) * 0.5, 0, 0);
  add(targets, 'rightLowerLeg', Math.max(0, weight) * 0.5, 0, 0);

  add(targets, 'leftUpperArm', microL + driftSlow * 0.3, drift * 0.5, sway * 0.12 + drift + breathe * 0.5);
  add(targets, 'rightUpperArm', microR - driftSlow * 0.3, -drift * 0.5, -sway * 0.12 - drift - breathe * 0.5);
  add(targets, 'leftLowerArm', microL * 1.5, microL * 2.5 + driftSlow, drift * 0.4);
  add(targets, 'rightLowerArm', microR * 1.5, -microR * 2.5 - driftSlow, -drift * 0.4);
  add(targets, 'leftHand', 0, microL * 3, microL * 2);
  add(targets, 'rightHand', 0, -microR * 3, -microR * 2);

  const eyeYaw = cursorX * 0.4;
  const eyePitch = -cursorY * 0.25;

  if (asleep) {
    add(targets, 'head', 0.35 + breathe, sway * 0.2, 0.1);
  } else {

    add(targets, 'head', breathe * 0.6 + eyePitch + driftSlow * 0.3, sway * 0.7 + eyeYaw - weight * 0.35, weight * 0.45 + sway * 0.1);
  }

  if (!asleep) def.fn(t, el, targets);

  if (!asleep && behavior !== 'idle') {
    const lifeBreathe = Math.sin(t * 1.2) * 0.012;
    const lifeSway = Math.sin(t * 0.5 + 0.8) * 0.018;
    add(targets, 'chest', lifeBreathe, 0, lifeBreathe * 0.5);
    add(targets, 'spine', lifeBreathe * 0.4, lifeSway * 0.3, lifeSway * 0.2);
    add(targets, 'head', lifeBreathe * 0.3, lifeSway * 0.4, 0);
    add(targets, 'leftUpperArm', microL * 0.6, 0, microL * 0.4);
    add(targets, 'rightUpperArm', microR * 0.6, 0, -microR * 0.4);
  }

  return targets;
}

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
const SMOOTH = 9;

const BONE_EASE = {
  hips: 4, spine: 5, chest: 6,
  head: 8,
  leftUpperArm: 6, rightUpperArm: 6,
  leftLowerArm: 9, rightLowerArm: 9,
  leftHand: 12, rightHand: 12,
  leftUpperLeg: 5, rightUpperLeg: 5,
  leftLowerLeg: 8, rightLowerLeg: 8,
};

function applyPoseSmoothed(dt, t) {
  if (!currentVrm?.humanoid) return;

  const el = t - poseStartTime;

  if (!['dance', 'jump', 'kneel', 'walk'].includes(behavior)) {
    modelGroup.position.y = THREE.MathUtils.lerp(modelGroup.position.y, 0, 1 - Math.exp(-6 * dt));
  }

  const targets = computePoseTargets(t, el);
  if (!targets) return;

  TRACKED_BONES.forEach((name) => {
    const b = bone(name);
    if (!b) return;
    const target = targets[name];
    _targetEuler.set(target.x, target.y, target.z, 'XYZ');
    _targetQuat.setFromEuler(_targetEuler);

    const speed = BONE_EASE[name] || SMOOTH;
    b.quaternion.slerp(_targetQuat, 1 - Math.exp(-speed * dt));
  });

  const now = performance.now();
  const squish = now < reactionUntil ? 0.92 : 1.0;
  const targetScale = (Number($('sizeSlider').value) / 100) * squish;
  modelGroup.scale.setScalar(THREE.MathUtils.lerp(modelGroup.scale.x, targetScale, 1 - Math.exp(-20 * dt)));

  if (currentVrm && !['dance', 'jump', 'kneel'].includes(behavior)) {
    currentVrm.scene.position.y = asleep ? 0 : Math.sin(t * 1.2 * swaySpeed) * 0.01;
  }
}

function applyAmbientWind(t) {
  const manager = currentVrm?.springBoneManager;
  if (!manager?.joints) return;
  try {
    const boosted = behavior === 'wind';

    const gust = (Math.sin(t * 0.8) * 0.5 + Math.sin(t * 1.9 + 1.0) * 0.3 + Math.sin(t * 3.7 + 2.0) * 0.2);
    const dirX = Math.sin(t * 1.6) * 0.6 + gust * 0.3;
    const dirZ = Math.cos(t * 1.1) * 0.4 + gust * 0.2;

    const basePower = 0.25;
    const swing = (0.5 + 0.5 * gust);
    const power = boosted
      ? basePower + 1.6 * swing
      : basePower + 0.35 * swing;

    manager.joints.forEach((joint) => {
      const s = joint.settings;
      if (!s) return;
      if (s._origGravityPower === undefined) {
        s._origGravityPower = (s.gravityPower !== undefined) ? s.gravityPower : 0;
      }

      if (s.gravityDir) s.gravityDir.set(dirX, -0.5, dirZ).normalize();
      if (s.gravityPower !== undefined) s.gravityPower = s._origGravityPower + power;
    });
  } catch (e) {  }
}

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

  if (t > nextBlinkAt && blinkUntil < t) {
    blinkUntil = t + 0.12;
    nextBlinkAt = t + 2.2 + Math.random() * 3.0;
  }
  const blinkValue = asleep ? 1 : (t < blinkUntil ? 1 : 0);
  em.setValue('blink', blinkValue);

  if (flashExpressionName && performance.now() < flashExpressionUntil) {
    EXPRESSION_NAMES.forEach((n) => em.setValue(n, n === flashExpressionName ? 1 : 0));
  } else if (flashExpressionName) {
    flashExpressionName = null;
    applyExpression(currentExpression);
  }

  const mouthValue = speaking ? mouthEnvelope : 0;
  if (em.setValue) {
    try { em.setValue('aa', mouthValue); } catch (e) {  }
  }
}

const SLEEP_AFTER_MS = 5 * 60 * 1000;
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

const fallbackLines = [
  "Don't forget to take a break~",
  'Compiling... or am I just thinking?',
  'Nice desktop today.',
  "I'm watching the cursor. No reason.",
  '*stretches*',
  'How long have we been at this?',
  'I could go for a snack. Metaphorically.',
  'You doing okay over there?',
  'The cursor went that way. I saw it.',
  'Just vibing on your desktop.',
  '*hums quietly*',
  "Don't mind me.",
];

let lastChatterLine = '';
function pickFallbackLine() {
  if (fallbackLines.length < 2) return fallbackLines[0];
  let line;
  do { line = fallbackLines[Math.floor(Math.random() * fallbackLines.length)]; }
  while (line === lastChatterLine);
  lastChatterLine = line;
  return line;
}

function showBubble(text) {
  bubble.textContent = text;
  bubble.style.left = (stage.clientWidth / 2 + 60) + 'px';
  bubble.style.top = (stage.clientHeight / 2 - 220) + 'px';
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
    return pickFallbackLine();
  }
  const hour = new Date().getHours();
  const timeOfDay = hour < 6 ? 'late night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const clipboardNote = clipboardSwitch.get() && lastClipboardSnippet
    ? `The user's clipboard recently contained: "${lastClipboardSnippet.slice(0, 200)}".`
    : '';
  const system = `You are a small, cheerful desktop companion character. Say one short (under 15 words), casual, in-character idle remark. It is currently the ${timeOfDay}. ${clipboardNote} Do not repeat yourself. Do not use quotation marks.`;

  const res = await window.companionAPI?.aiChat(aiProvider, $('modelInput').value, [
    { role: 'user', content: 'Say something idle and in-character.' },
  ], system);

  if (res?.ok && res.text && res.text !== lastChatterLine) { lastChatterLine = res.text; return res.text; }
  return pickFallbackLine();
}

function queueChatter() {
  clearTimeout(queueChatter._t);
  queueChatter._t = setTimeout(async () => {
    if (chatterSwitch.get() && !asleep) {
      const line = await generateChatterLine();
      showBubble(line);
      if (idleVoiceSwitch.get()) speak(line);
    }
    queueChatter();
  }, 14000 + Math.random() * 16000);
}

const chatHistory = [];
let speaking = false;
let mouthEnvelope = 0;
let voiceVolume = 0.8;
let audioCtx = null;

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
  const selectedName = $('browserVoiceSelect').value;
  if (selectedName) {
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.name === selectedName);
    if (match) utter.voice = match;
  }
  speaking = true;

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

    if (all.memoryEnabled) {
      const mem = (await window.companionAPI?.memoryGet?.()) || [];
      mem.push({ role: 'user', content: (text || '[looked at screen]').slice(0, 160) });
      mem.push({ role: 'assistant', content: res.text.slice(0, 160) });

      await window.companionAPI?.memorySet(mem.slice(-40));
    }
  } else {
    showBubble(`(error: ${res?.error || 'no response'})`);
  }
}

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

$('visionBtn').addEventListener('click', async () => {
  const settings = (await window.companionAPI?.getAllSettings?.()) || {};
  if (!settings.visionEnabled) { showBubble('Enable Vision in Settings → AI first.'); return; }
  const btn = $('visionBtn');
  btn.classList.add('active');
  await lookAtScreen();
  btn.classList.remove('active');
});

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
  populateModelList(aiProvider, true);

  chatterSwitch.set(settings.chatterEnabled !== false);
  idleVoiceSwitch.set(!!settings.idleVoiceEnabled);
  autoSleepSwitch.set(settings.autoSleep !== false);
  cpuWarnSwitch.set(settings.cpuWarnEnabled !== false);
  minimalSwitch.set(!!settings.minimalMode);
  document.body.classList.toggle('minimal', !!settings.minimalMode);

  features.eyeTracking = settings.eyeTracking !== false;
  features.idleVariation = settings.idleVariation !== false;
  features.physicsReactions = settings.physicsReactions !== false;
  $('toggleEyeTracking').classList.toggle('on', features.eyeTracking);
  $('toggleIdleVariation').classList.toggle('on', features.idleVariation);
  $('togglePhysics').classList.toggle('on', features.physicsReactions);

  const mode = settings.moveMode || 'off';
  wanderSwitch.classList.toggle('on', mode === 'wander');
  followSwitch.classList.toggle('on', mode === 'follow');
  syncMoveMode();

  $('toggleMemory').classList.toggle('on', !!settings.memoryEnabled);
  $('toggleVision').classList.toggle('on', !!settings.visionEnabled);
  ttsSwitch.set(!!settings.ttsEnabled);
  $('ttsRow').style.display = settings.ttsEnabled ? 'block' : 'none';
  $('browserVoiceRow').style.display = settings.ttsEnabled ? 'none' : 'block';
  if (settings.browserVoice) $('browserVoiceSelect').value = settings.browserVoice;
  const ttsProv = settings.ttsProvider || 'openai';
  $('ttsProviderSelect').value = ttsProv;
  populateVoiceList(ttsProv, settings.ttsVoice || null);
  if (settings.ollamaUrl) $('ollamaUrlInput').value = settings.ollamaUrl;
  if (settings.ollamaModel) $('ollamaModelInput').value = settings.ollamaModel;
  if (settings.apiKeys?.elevenlabs) $('elevenKeyInput').value = settings.apiKeys.elevenlabs;

  const startupOn = await window.companionAPI?.getStartup?.();
  startupSwitch.set(!!startupOn);
  muteSwitch.set(!!settings.muted);
  clipboardSwitch.set(!!settings.watchClipboard);
  topSwitch.set(settings.alwaysOnTop !== false);
  clickThroughSwitch.set(!!settings.clickThrough);
  charClickThrough = !!settings.clickThrough;
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

const _eyeTmp = new THREE.Vector3();
function updateEyeLookAt(dt) {
  if (!currentVrm?.lookAt) return;
  if (!features.eyeTracking || asleep) {

    _eyeTmp.set(0, 1.3, 5);
  } else {

    const headPos = currentVrm.humanoid?.getNormalizedBoneNode('head')?.getWorldPosition(new THREE.Vector3())
      || new THREE.Vector3(0, 1.3, 0);
    _eyeTmp.set(headPos.x + cursorX * 1.4, headPos.y - cursorY * 1.0, headPos.z + 4);
  }
  lookAtTarget.position.lerp(_eyeTmp, 1 - Math.exp(-10 * dt));
}

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

    if (IDLE_ALTERNATES.includes(behavior)) setBehavior('idle');
    savedBehaviorForVariation = null;
  }
}

let movingNow = false;
let faceDir = 1;
let savedBehaviorBeforeWalk = null;

window.companionAPI?.onMoveState((s) => {
  if (s.moving) {
    if (!movingNow) {
      savedBehaviorBeforeWalk = behavior === 'walk' ? 'idle' : behavior;
      setBehavior('walk');
    }
    if (s.dirX !== 0) faceDir = s.dirX;
    movingNow = true;
    lastInteractionTime = performance.now();
  } else {
    if (movingNow && behavior === 'walk') setBehavior(savedBehaviorBeforeWalk || 'idle');
    movingNow = false;
  }
});

window.companionAPI?.onMovePos((p) => {
  stage.style.bottom = 'auto';
  stage.style.right = 'auto';
  stage.style.left = p.x + 'px';
  stage.style.top = p.y + 'px';
});

window.companionAPI?.onResetPosition(() => {
  stage.style.left = '';
  stage.style.top = '';
  stage.style.bottom = '20px';
  stage.style.right = '20px';
});

function setMovementMode(mode) {
  window.companionAPI?.setMoveMode(mode);
}

let dragVelX = 0, dragVelY = 0;
let leanX = 0, leanZ = 0, leanVX = 0, leanVZ = 0;
function pushDragVelocity(dx, dy) {
  if (!features.physicsReactions) return;
  dragVelX = dx; dragVelY = dy;
}
function updatePhysicsLean(dt) {
  if (!features.physicsReactions) { leanX = leanZ = 0; return; }
  const targetZ = THREE.MathUtils.clamp(-dragVelX * 0.012, -0.5, 0.5);
  const targetX = THREE.MathUtils.clamp(dragVelY * 0.012, -0.5, 0.5);
  const k = 90, c = 14;
  leanVZ += (-(leanZ - targetZ) * k - leanVZ * c) * dt;
  leanVX += (-(leanX - targetX) * k - leanVX * c) * dt;
  leanZ += leanVZ * dt;
  leanX += leanVX * dt;
  dragVelX *= Math.exp(-6 * dt);
  dragVelY *= Math.exp(-6 * dt);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  checkAutoSleep();
  updateIdleVariation();
  updatePhysicsLean(dt);

  if (currentVrm) {
    currentVrm.update(dt);
    applyPoseSmoothed(dt, t);
    const spine = currentVrm.humanoid?.getNormalizedBoneNode('spine');
    const chest = currentVrm.humanoid?.getNormalizedBoneNode('chest');
    if (spine) { spine.rotation.x += leanX * 0.6; spine.rotation.z += leanZ * 0.6; }
    if (chest) { chest.rotation.x += leanX * 0.4; chest.rotation.z += leanZ * 0.4; }

    const targetYaw = faceDir < 0 ? Math.PI : 0;
    if (behavior !== 'spin') {
      modelGroup.rotation.y += (targetYaw - modelGroup.rotation.y) * (1 - Math.exp(-8 * dt));
    }
    updateEyeLookAt(dt);
    updateBlinkAndExpression(t);
    applyAmbientWind(t);
  }

  renderer.render(scene, camera);
}
animate();
