# Desktop Companion

A transparent, always-on-top 3D desktop companion built with **Electron**, **three.js + @pixiv/three-vrm**, and an optional AI brain (Claude / GPT / Gemini). The character floats above your other windows, animates, reacts to your cursor, and can chat with you by text or voice.

## Features

**Visuals & animation**
- Frameless, transparent, always-on-top window with real OS-level pinning
- Camera auto-frames the whole model on load/resize — nothing gets cropped
- Relaxed standing default pose, not a T-pose: VRM files store their bind pose as a literal T-pose (rotation zero on every bone IS the T-pose), so every behavior now layers on top of a `BASE_POSE` with arms relaxed down at the sides instead of starting from zero rotation
- Correct color pipeline (sRGB output + ACES tone mapping) and neutral bright lighting, so the character shows its true material colors instead of being dimmed or tinted by colored scene lights
- Natural, non-stiff posing: a resting elbow bend and slight asymmetry in the base stance, plus a layered idle (breathing across the torso chain, a slow side-to-side weight shift, and per-side micro-motion at different phases) so the character never looks like a frozen mannequin
- Constant turbulent wind that drives spring-bone force strength (not just direction), so hair and cloth visibly blow and sway all the time; the "Wind gust" pose surges it much stronger
- Smooth, lerped pose transitions using quaternion slerp — switching behaviors eases instead of snapping. (Earlier versions interpolated each Euler axis independently, which is an invalid way to blend rotations whenever more than one axis changes at once — it can produce in-between orientations that aren't actually "between" the two poses, which is what caused limbs to fly into nonsense positions mid-transition. Fixed by interpolating quaternions instead.)
- "Hide everything but the character" toggle (Settings → System) — hides the chat bar, drag handle, and speech bubbles, and fades the gear icon to near-invisible; hover the bottom-right corner to bring the gear back
- Open on system startup (Settings → System), using Electron's native login-item registration
- Settings panel can be dragged around by its header, has a close button, and uses a clean themed scrollbar instead of the default one
- Click-through no longer traps you: while it's on, the desktop stays clickable through the character, but moving the cursor over the gear or open settings panel temporarily re-captures the mouse so you can still use and disable it
- First-run launcher offers to create a desktop shortcut; open-on-startup is offered inside the app
- 27 behaviors total: idle/breathing, look around, greeting wave, wind gust, sit/perch, thinking, freeze, bow, salute, clap, cheer, shrug, point, peace sign, dance, stretch, yawn, facepalm, arms crossed, hands on hips, jump/bounce, spin, bashful, kneel, applaud, confused, determined stance, lean back
- Auto-sleep after 5 minutes of inactivity (slower breathing, closed eyes), wakes on interaction
- Periodic auto-blink and a selectable base expression (happy/relaxed/sad/angry/surprised), plus a brief "surprised" flash when you click/drag the character
- Eye/head tracking that follows your real OS cursor position anywhere on the desktop, not just inside the companion's own window
- Lip-sync while speaking, driven from word-boundary timing on the speech synthesis (see honest scope note below)
- Outfit/parts panel: lists every mesh in the loaded model so you can show/hide pieces — works generically on any VRM with separate mesh objects for clothing/hair variants

**AI & voice**
- Chat bar at the bottom of the window — type to talk to your companion
- Voice input via the browser's built-in Speech Recognition (mic button)
- Four providers: Anthropic (Claude), OpenAI (GPT), Google (Gemini), and **Ollama** for fully local, offline, free chat (no API key — just a local Ollama server with a model pulled; includes a connection test button)
- **Persistent memory** — optionally remembers past conversations across restarts (stored locally), injected as context so the companion has continuity; clearable from settings
- **Real API TTS with true amplitude lip-sync** — optionally routes speech through OpenAI TTS or ElevenLabs, decodes the returned audio, and drives the mouth blendshape from a live loudness analyser (real viseme-ish sync, not the word-timing approximation); falls back to browser speech when off
- **Vision** — optional; an eye button captures your screen and asks the model to react to what's on it (works with any vision-capable model across the four providers)
- Idle chatter becomes contextual once a provider is configured (time of day + optional clipboard snippet), falling back to static lines otherwise

**Lifelike motion (procedural)**
- Procedural eye look-at: the eyes track your cursor independently of the head via the VRM `lookAt` system, which reads as much more alive than head-only tracking
- Idle variation: every 20-35s on plain idle, the character briefly drifts to a relaxed alternate pose then back, so it never loops one identical motion
- Drag-velocity physics: fling the window and the character leans against the motion with a springy spring-damped recovery (hair already lags naturally on top)
- Walk / wander mode: the window drifts on its own toward screen-edge waypoints with a proper stride+arm-swing walk animation, and a "Summon to cursor" button calls it toward your mouse
- All four are individual toggles and persist across restarts

**System awareness**
- Clipboard watching (off by default, opt-in toggle) — feeds short snippets into idle chatter context only, never auto-comments on every copy
- CPU load warnings via Node's built-in `os` module
- Global hotkey **Alt+Shift+L** shows/hides the companion from anywhere
- Drag near a screen edge to snap the window to it, like a real desktop pet

**Persistence & settings**
- Size, sway speed, behavior, expression, character, window position, volume/mute, and all toggles persist across restarts via `electron-store`
- Character library with import (drag a `.zip` containing a `.vrm`), rename, and delete, all from the Appearance tab
- Settings panel reorganized into Appearance / AI / System tabs
- Toggle switches were rebuilt so their visible on/off state is the single source of truth (read directly from a CSS class) instead of a separate tracked variable that could drift out of sync after repeated clicks or IPC round-trips

## Quick start (no terminal needed)

Requires [Node.js](https://nodejs.org) 18+ installed once, beforehand.

- **Windows:** double-click `start.bat`
- **macOS / Linux:** double-click `start.sh` (or `./start.sh` in a terminal — `chmod +x start.sh` once first)

First run installs dependencies automatically (downloads Electron — a few minutes), then launches the companion.

## Manual setup (terminal)

```bash
cd liqu-companion
npm install
npm start
```

## Building a real installer (.exe / .dmg / .AppImage)

- **Windows:** double-click `build-installer.bat`
- **macOS / Linux:** run `./build-installer.sh`

Or manually: `npm run dist` / `npm run dist:win` / `npm run dist:mac` / `npm run dist:linux`. Output goes to `dist/`.

**The Windows installer is a proper setup wizard** (NSIS), not a silent copy. When the user runs `Liqu Companion Setup x.x.x.exe` they get a wizard that lets them choose the install directory, opt in/out of desktop and Start-Menu shortcuts, and launch the app when setup finishes.

**Uninstalling:** the installer registers Liqu Companion in Windows "Add or Remove Programs" and adds a Start-Menu uninstall entry — uninstall it like any normal app. (Your saved settings and imported characters in the user-data folder are kept by default so a reinstall remembers everything; delete that folder manually if you want a totally clean removal. On macOS, drag the app to Trash; on Linux, remove the AppImage or `apt remove` the `.deb`.)

A placeholder neon `icon.png` and `tray.png` are included in `assets/icons/` so the build works out of the box — replace them with your own art before a real release. For the sharpest Windows installer icon, supply a multi-resolution `.ico` and point `build.win.icon` at it.

## Setting up AI chat

1. Open the gear icon → **AI** tab.
2. Pick a provider and paste an API key from that provider's developer console (Anthropic Console, OpenAI Platform, or Google AI Studio).
3. Optionally set a specific model name; leave blank to use a sensible default per provider.
4. Type in the chat bar, or tap the mic and speak.

Keys are stored locally via `electron-store` in plain form in your OS user-data folder — fine for a personal machine, not a hardened secrets vault. Don't share your `config.json` from that folder.

### Local, offline, free chat with Ollama

1. Install Ollama from [ollama.com](https://ollama.com) and pull a model, e.g. `ollama pull llama3.2` (or a vision model like `llama3.2-vision` / `llava` if you want the Vision feature offline).
2. In the AI tab, set Provider to **Ollama**, confirm the server URL (default `http://localhost:11434`), enter the model name, and hit **Test** to verify the connection.
3. No API key needed — everything runs locally and privately.

### Persistent memory

Toggle **Persistent memory** in the AI tab. The companion will store a rolling recap of your conversations locally and feed it back as context so it remembers across restarts. Use **Clear memory** to wipe it.

### Real voice (better lip-sync)

Toggle **Real voice (API TTS)** in the AI tab, choose OpenAI TTS or ElevenLabs, set a voice name/ID, and (for ElevenLabs) paste its key. Speech then uses real generated audio with amplitude-driven mouth movement. Left off, it uses the built-in browser voice.

### Vision

Toggle **Vision** in the AI tab, then click the 👁 button in the chat bar. The app captures your screen and asks the model to react to what's on it. Requires a vision-capable model (most current Claude/GPT/Gemini models, or a vision model in Ollama).

## Adding more characters

Drop a `.zip` containing a `.vrm` onto the Appearance tab's drop zone, or click it to browse. Imported characters land in your OS user-data folder (survives app updates) and can be renamed or deleted from the same tab. Storage locations:

- Windows: `%APPDATA%\liqu-desktop-companion\characters\`
- macOS: `~/Library/Application Support/liqu-desktop-companion/characters/`
- Linux: `~/.config/liqu-desktop-companion/characters/`

## Tuning poses for a new character

All arm poses are expressed through an `armLift(side, lift, fwd, bend)` helper and a single `ARM_DOWN` direction constant near the top of the pose system in `src/renderer/companion.js`, rather than scattered raw rotation values. `lift` is intuitive: 0 = arm down at the side, 1 = straight out horizontally, 2 = straight up. If a different model's arms raise when they should lower (or vice versa), flip the sign of `ARM_DOWN` in that one place and every pose corrects at once. Individual poses live in the `POSES` table just below and mostly call `armLift`, so adjusting one pose won't break the others.

## Project structure

```
liqu-companion/
├── package.json
├── start.bat / start.sh                 # one-click launcher (installs deps + runs)
├── build-installer.bat / .sh            # produces a real native installer
├── src/
│   ├── main.js              # window, tray, persistence, AI proxy, system awareness, hotkey
│   ├── preload.js           # secure bridge between main and renderer
│   └── renderer/
│       ├── index.html
│       ├── style.css
│       └── companion.js     # scene, pose system, AI chat/voice, character library UI
├── assets/
│   ├── model/Liqu.vrm       # bundled VRM model
│   └── icons/                # add icon.png + tray.png before building installers
└── LICENSE-MODEL/           # Liqu's original license terms
```

## Model license

The bundled `Liqu.vrm` is © its original creator. Personal use, commercial use, live-streaming, and software/product integration are permitted under its license — see `LICENSE-MODEL/vn3license_en.pdf` (the Japanese original takes precedence in case of conflicts).

## Offline / production note

`three`, `three-vrm`, and `jszip` currently load from CDNs (unpkg / esm.sh) via an import map, so the app needs internet on first run. For a fully offline build, install these as local npm packages and bundle with esbuild/Vite, updating the import map paths in `index.html` accordingly.
