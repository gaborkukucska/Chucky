# Woodchuck Dam Builder 3000 🦫

Welcome to **Woodchuck Dam Builder 3000** (a.k.a. *Chucky*), a 3D game where you play as an industrious woodchuck who chomps trees, hauls logs and builds the ultimate dam across the river.

## 🌟 Features

- **A new world every run**: Each game makes its own seeded world with a river, hills, 250 trees and boulders.
- **Chomp, collect, build**: Chomp trees into logs, pick them up and build 10 kinds of structure, from a *Small Pile* (7 logs) to the *Woodchuck Palace* (3,840 logs). A structure built in the river scores more than one on land.
- **Combos and power-ups**:
  - **Combo**: collect logs quickly to raise a multiplier up to 4x.
  - **Mega Chomp**: chomp 3 trees within 30 seconds to chomp every tree around you.
  - **Magnet**: reach a 3x combo and nearby logs fly to you.
  - **Zoomies**: eat 3 berries to run and swim faster for 20 seconds.
- **Swimming and diving**: Swim across the river and dive for logs and fruit that have sunk. Keep an eye on the breath bar.
- **Day and night**: The sun and moon move across the sky. At night wolves and bears come out.
- **Four camera views**:
  - **3rd person** chase cam behind Chucky.
  - **Overview**.
  - **Top-down** map view.
  - **Cinematic** orbit.

  A zoom slider on the right edge of the screen moves the camera in and out.
- **Save and load**: Three save slots on each device, from the in-game menu.
- **Settings**: Choose Low, Medium or High graphics quality, and switch music, environment sounds (river, wind, birds, crickets) and sound effects on or off separately.
- **Live, shared leaderboard**: Your current run updates the leaderboard as you play. Every device that plays from the same server (your laptop and phones on the same Wi-Fi) shares one board.
- **Mobile first**: Touch joystick, a dive button for the left thumb and a compact HUD. Keyboard and mouse also work.

## 🚀 Installation & Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- A computer (Windows, Mac or Linux), or a phone with Termux
- Optional: a phone on the same local network, to play with touch controls

### Steps

1. **Clone the repository** (or download the source code):
   ```bash
   git clone https://github.com/gaborkukucska/Chucky.git
   cd Chucky
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm start
   # or
   npm run dev
   ```

4. **Play!**
   - **Local**: open the URL shown in the terminal (usually `http://localhost:3000`).
   - **Network (mobile)**: open the "Network" URL from the terminal (e.g. `http://192.168.1.5:3000`) in your phone's browser.

5. **Production build** (optional):
   ```bash
   npm run build      # creates dist/
   npm run preview    # serves dist/, including the shared leaderboard
   ```

> An internet connection is needed for the styling (Tailwind CSS is loaded from a CDN) and for the clouds. If the cloud texture can't load, the game simply runs without clouds.

### The shared leaderboard

The leaderboard is served by the same Vite server that serves the game (`npm start`, `npm run dev` or `npm run preview`). Scores are stored in `data/leaderboard.json` in the project folder. Git ignores that file, so every machine keeps its own board.

If you host only the built `dist/` folder somewhere else, the API isn't there. The game then falls back to a leaderboard on each device, and the leaderboard screen says so (🌐 shared or 📱 this device only).

## 📱 Mobile / Termux Troubleshooting

If you run the server directly on your phone with Termux:

1. Make sure `nodejs` and `git` are installed:
   ```bash
   pkg install nodejs git
   ```
2. If the server starts but you can't reach it, try `127.0.0.1:3000` instead of `localhost`.
3. If file changes aren't detected, run with polling:
   ```bash
   CHOKIDAR_USEPOLLING=true npm start
   ```

## 🎮 How to Play

1. **Chomp trees**: walk up against a tree trunk and Chucky chomps it automatically. The bar at the top shows the tree's health. Felled trees drop logs and sometimes an apple or a berry.
2. **Collect logs**: walk over logs to pick them up. Picking logs up quickly builds your combo.
3. **Build**: tap 🏗️, pick an unlocked blueprint and place it. The preview is green when the spot is valid and red when it isn't (not enough wood, too close to another structure, or off the map).
4. **Eat**: apples heal 20 and berries heal 10 (up to 200% health). Every 3rd berry gives you Zoomies.
5. **Survive the night**: wolves and bears hurt. Stay clear, or head for the water.

If the game runs slowly on your phone, open ☰ → ⚙️ Settings and pick **Low** graphics. Settings is also on the start screen.

Your score unlocks bigger blueprints. The run lasts until your health runs out. Your score is on the leaderboard the whole time, so you don't have to finish a game for it to count.

## 🕹️ Controls

### Touch

| Control | What it does |
|---|---|
| **Joystick** (bottom middle) | **3rd person view:** up/down walks forward/back, left/right turns Chucky (the camera stays behind him). **Other views:** push where you want to go on the screen. |
| **🤿 Dive** (bottom left, in water) | Hold to dive, release to float back up. Watch the breath bar. |
| **Zoom slider** (right edge) | Slide up to move the camera closer, down to move it further away. Double-tap the slider to reset. |
| **🏗️ / ✅ / 💥** (top right) | Opens the build menu. Becomes ✅ to **place** while building. Next to a structure it becomes 💥: **hold** it to demolish (you get 80% of the logs back). |
| **✖️** | Stop building. |
| **📷** | Switch the camera: 3rd person → Overview → Top-down → Cinematic. |
| **☰** | Menu: Resume, Save, Load, Leaderboard, Settings, New game. Opening it pauses the game. |
| **↺ / ↻** (while building) | Rotate the structure. |

### Keyboard & mouse

| Key | What it does |
|---|---|
| **W A S D** / **arrow keys** | Move (in 3rd person: W/S forward/back, A/D turn) |
| **Space** (hold) | Dive |
| **Mouse wheel** | Zoom the camera |
| **R** or **E** / **Q** | Rotate the structure while building (Q turns the other way) |
| **Enter** | Place the structure |
| **Esc** | Open/close the menu, or close the build menu |

## 🛠️ Built With

- **React 19**: UI and components
- **Three.js** with **@react-three/fiber** and **@react-three/drei**: 3D rendering, sky, stars and clouds
- **Cannon.js** (**@react-three/cannon**): physics for logs, food and structures, running in a web worker
- **Zustand**: game state
- **Vite 6**: dev server, build and the shared leaderboard API
- **Tailwind CSS** (CDN): styling

## 👩‍💻 Developer notes

### Project layout

| Path | Purpose |
|---|---|
| `store.ts` | All game state and rules (Zustand): world generation, chomping, logs, combos, power-ups, building, demolition, saving and loading, leaderboard sync, camera mode and zoom. Gameplay tuning constants are at the top of the file. |
| `components/Woodchuck.tsx` | The player: movement, collisions, swimming and diving, chomping, the placement preview, and the model. |
| `components/Game3D.tsx` | The scene: canvas, cameras, day/night lighting, time and destruction managers, food, mobs, grass, graphics quality, environment-sound updates. |
| `components/WorldObjects.tsx` | Trees, boulders, loose logs (debris bundles), placed structures (instanced) and the placement preview. |
| `components/Controls.tsx` | Joystick, dive button, zoom slider, top-right buttons and keyboard/mouse input. It writes to `window.woodchuckInput`. |
| `App.tsx` | HUD, combo display, power-up pills, notifications, build menu, placement panel, in-game menu, settings, start and game-over screens, leaderboard. |
| `services/audio.ts` | Synthesized sound (no audio files) on three channels that can be muted separately: music, environment and sound effects. |
| `services/persistence.ts` | localStorage saves (3 slots), player name, camera zoom, graphics quality, sound settings, and the leaderboard client (shared API with a fallback to each device). |
| `server/leaderboardApi.ts` | Vite plugin: `GET` and `POST /api/leaderboard`, stored in `data/leaderboard.json`. |
| `globals.ts` | Shared mutable values read every frame without causing re-renders: player position and facing, live log and fruit positions (used by saves). |

### Key design decisions

- **Kinematic player.** Chucky is a kinematic physics body that the code moves itself. Collisions with trees, boulders and structure logs are resolved by hand in `Woodchuck.tsx`. Physics contacts between a kinematic and a static body never fire, so gameplay never relies on them: chomping and pick-ups use distance checks.
- **Frame-rate independent.** Smoothing uses `1 - exp(-rate * dt)` and long frames are clamped (`MAX_FRAME_DELTA`). A slow phone plays the same as a fast laptop.
- **No per-frame React churn.** Per-frame data lives in refs and `globals.ts`. Store actions return `state` unchanged when nothing changed, so subscribers aren't woken. Components use selectors.
- **Small saves.** Worlds come from a seed (mulberry32), so a save stores the seed plus what changed (tree health, structures, logs, fruit, player, timers).
- **Cheap big structures.** Each placed structure is one instanced draw call. Physics uses one box per log for small structures and one box per layer for big ones. Demolition drops at most 12 "bundles", each worth several logs.
- **Pausing is real.** Menus pause the game, and resuming shifts every combo and power-up deadline by the paused time.

### Cameras (`CameraController` in `Game3D.tsx`)

| Mode | Label | Behaviour | Movement controls |
|---|---|---|---|
| `BEHIND` | 3rd person | Chase cam 8 units behind and 3.5 above Chucky. It eases round to his facing. If a tree would block the view, it slides in front of the tree. | Steering: stick X turns (up to `STEER_RATE` 1.8 rad/s, gentler for small pushes), stick Y walks along the facing; backwards at 50% speed. |
| `FOLLOW` | Overview | High three-quarter view from the south (18 up, 26 back), aligned to the world. | Relative to the camera |
| `TOP_DOWN` | Top-down | Map view, 42 above. | Relative to the camera |
| `CINEMATIC` | Cinematic | Slow, low orbit (radius 20, height 6). | Relative to the camera |

All distances are multiplied by `cameraZoom`, which runs from `CAMERA_ZOOM_MIN` 0.45 to `CAMERA_ZOOM_MAX` 2.2 and is saved per device. The camera always stays above the terrain and above the water surface.

The chase cam needs steering controls. With controls relative to a camera that turns with Chucky, he would run in circles.

### Graphics quality

| Setting | Grass | Pixel ratio | Sun shadow map | Clouds |
|---|---|---|---|---|
| Low | 5×5 tiles (60 m), 1,125 blades | 1 | 512 | off |
| Medium | 9×9 tiles (108 m), 4,860 blades | up to 1.5 | 1024 | on |
| High | 11×11 tiles (132 m), 10,890 blades | up to 2 | 2048 | on |

Phones and tablets start on Medium and computers on High, until the player picks a setting. Grass is only drawn in the tiles around Chucky (12 m each). When he walks into a new tile, only the row of tiles that came into range is rebuilt, and blades shrink into the ground near the edge. The sun's and moon's shadow maps are only re-rendered while that light is up.

### Sound

All sound is synthesized in `services/audio.ts` and mixed on three channels: **music**, **environment** and **sfx**. A muted channel stops scheduling sounds, so it costs nothing. The environment channel plays a river (louder near the water, muffled under it), wind, birds by day and crickets at night; `AmbientAudioManager` in `Game3D.tsx` updates it four times a second. Audio pauses while the tab or app is in the background.

### Useful tuning knobs

- `store.ts` (top): tree and boulder counts, food drop chance, power-up durations, combo windows, unlock thresholds, build points, debris limits, leaderboard sync interval.
- `Woodchuck.tsx` (top): walk and swim speed, acceleration, turn and steer rates, diving and breath, chomp damage and reach, placement spacing.
- `Game3D.tsx`: `QUALITY_SETTINGS` and `GRASS_QUALITY` (what each graphics setting does), `GRASS_TILE`, and the camera constants (`CHASE`, `OVERVIEW`, `TOP_DOWN_VIEW`, `CINEMATIC_VIEW`).
- `services/audio.ts` (top): river, wind and underwater sound levels.

### Checking your changes

```bash
npx tsc --noEmit    # type check (should report no errors)
npm run build       # production build
```

See [CHANGELOG.md](CHANGELOG.md) for the history of fixes and features.

## 📜 License

This project is open source under the MIT License. See [LEGAL.md](LEGAL.md) for details.

## ✨ Credits

Originally developed by **Google Gemini**, an AI assistant by Google. Later fixes and features (see the changelog) were developed with **Claude**, an AI assistant by Anthropic.

*Crafted with code and creativity.* 🤖✨
