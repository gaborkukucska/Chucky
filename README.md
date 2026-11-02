# Chucky the Woodchuck 🦫

Welcome to **Chucky the Woodchuck**, a 3D game where you play as Chucky, an industrious **beaver** who chomps trees, hauls logs and builds the ultimate dam across the river. (Yes, the title is a joke: woodchucks don't actually chuck wood. Chucky will tell you all about it.)

## 🌟 Features

- **A new world every run**: every game makes its own map from a random seed: the river's path and width, the hills and ponds, 250 trees and boulders. A saved game keeps the map it was made on.
- **Chomp, collect, build**: Chomp trees into logs, pick them up and build 10 beaver structures, from a *Food Cache* (7 logs) to the *Beaver Kingdom* (3,840 logs): dams that curve upstream, and lodges with an air vent and underwater entrance tunnels. A structure built in the river scores more than one on land.
- **Combos and power-ups**:
  - **Combo**: collect logs quickly to raise a multiplier up to 4x.
  - **Mega Chomp**: chomp 3 trees within 30 seconds to chomp every tree around you.
  - **Magnet**: reach a 3x combo and nearby logs fly to you.
  - **Zoomies**: eat 3 berries to run and swim faster for 20 seconds.
  - **Magic items**: chased-off wolves, bears and piranhas can drop a glowing magic item. Walk into it to get one of these:
    - 🛡️ **Log Shield** (20 s): logs orbit you and bonk animals and rival players.
    - ✨ **Triple Chuck** (25 s): every throw launches three logs.
    - 🫧 **Bubble Breath** (30 s): endless air underwater.
    - 🌟 **Golden Teeth** (30 s): trees drop twice the logs.
- **River piranha**: one lurks in the river and bites when you swim near it. Two log hits chase it off for 50 points and a magic item, and another turns up a few minutes later.
- **Swimming and diving**: Swim across the river and dive for logs and fruit that have sunk. Keep an eye on the breath bar.
- **Chucky's fact nuggets**: in solo games, Chucky explains the game in a speech bubble when you start, then shares beaver facts and myth-busters as you play. He stays quiet in joint games. The text is in `public/chucky-facts.json`, which you can edit.
- **Throwing logs**: On land, tap the throw button for a short toss or hold it for a longer, higher throw; release to throw the way Chucky faces. Thrown logs spin randomly. A dotted line shows the flight path while you aim, and every throw flies a little off the aim. A wolf runs off after 2 hits and a bear after 3. A thrown log can be picked up again, but only gives the wood back.
- **Day and night**: The sun and moon move across the sky. At night wolves and bears come out.
- **Four camera views**:
  - **3rd person** chase cam behind Chucky.
  - **Overview**.
  - **Top-down** map view.
  - **Cinematic** orbit.

  A zoom slider on the right edge of the screen moves the camera in and out.
- **Save and load**: Three save slots on each device, from the in-game menu.
- **Settings**: Choose Low, Medium or High graphics quality, and switch music, environment sounds (river, wind, birds, crickets) and sound effects on or off separately.
- **Joint games**: Play together on the same Wi-Fi. One player creates a game and shares a room code (like BARK-27). Everyone races for the same trees, logs and fruit in one shared world. Pick a team colour: your logs hurt rivals but team mates catch them.
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
   # or, with the 🛠️ dev menu for testing power-ups:
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

### Joint games (same Wi-Fi)

1. Start the game on one computer with `npm start` (or `npm run preview`). Everyone opens the **Network** URL it prints, on any phone or laptop on the same Wi-Fi.
2. One player taps **👥 Play together**, picks a team colour and taps **Create a game**. The room code (e.g. **BARK-27**) shows in the HUD and in ☰ → Players.
3. **Invite with a QR code:** in the game, open ☰ → **👥 Players & invite** and let friends scan the QR code with their phone camera. It opens the game with the code filled in: they pick a colour and tap **Join**. (Or they open the Network URL, tap **👥 Play together**, pick a colour, type the code and tap **Join**.) Up to 8 players per game; late joiners get the world as it is now.

**What's shared, and the rules:**
- **Shared:** everyone plays in the same world: the same trees, tree damage, felled trees, loose logs and fruit, structures, and day and night.
- **Racing for resources:** the first player to reach a log or a piece of fruit gets it.
- **Teams:** pick Red, Blue, Green or Yellow; the same colour means team mates. **Solo** means everyone is your rival. Each Chucky wears a scarf in their team colour, with a name tag over their head.
- **Throwing:** a thrown log 🪵 hurts other players (20 damage and a knock-back). A team mate catches it instead and gets the wood.
- **Spawn points:** each team starts in its own corner of the map: Red north-west, Blue south-east, Green north-east, Yellow south-west. Team mates spread along the edges from there. **Solo** players start in the middle.
- **Knock-outs:** at zero health you're knocked out. You drop half your logs for others to grab, and 5 seconds later you're back at your team's corner (Solo: the middle) with your score kept.
- **Structures:** you can demolish your own and your team's, but not a rival's. Demolishing a team mate's structure doesn't cost you points.
- **No pausing or saving:** the game never pauses, because the world goes on for everyone, and joint games can't be saved.
- **Wolves and bears:** each player has their own.

The game server runs inside the same Vite server (WebSocket at `/ws/chucky`, via the `ws` package that `npm install` adds). The QR code links to `http://<this computer's Wi-Fi address>:<port>/?join=<code>`; the server reports its addresses at `/api/lan`, and if the computer is on more than one network you can pick which address the QR code uses. If the connection drops, the game says so and you can rejoin with the same code.

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

**No sound on a phone?** The sound starts with your first tap in the game. On an iPhone, the ring/silent switch also mutes web games: switch it to ring.

## 🎮 How to Play

When you start your first game, Chucky explains the basics in a speech bubble (Next ▶ / Skip, or Enter / Esc). After that, he pops up now and then with a beaver fact, and the game pauses while he talks. Chucky only talks in solo games: in joint games he stays quiet, so nobody gets interrupted (if your first game is a joint game, the tips wait for your first solo game). You can replay the tips from ☰ → 🦫 Chucky's tips in a solo game, and switch the facts off in ⚙️ Settings.

1. **Chomp trees**: walk up against a tree trunk and Chucky chomps it automatically. The bar at the top shows the tree's health. Felled trees drop logs and sometimes an apple or a berry.
2. **Collect logs**: walk over logs to pick them up. Picking logs up quickly builds your combo.
3. **Build**: tap 🏗️, pick an unlocked blueprint and place it. Dams are built across your view and curve away from you, so face upstream to dam the river. Build lodges in the shallows: the entrance tunnels sit at the bottom, so they end up under water while the dome rises out of it. The see-through preview is cyan when the spot is valid and red when it isn't (not enough wood, too close to another structure, or off the map).
4. **Eat**: apples heal 20 and berries heal 10 (up to 200% health). Every 3rd berry gives you Zoomies.
5. **Survive the night**: wolves and bears hurt. Stay clear, head for the water, or throw logs at them (🪵): a wolf runs off after 2 hits (+20 points) and a bear after 3 (+40). Chased-off animals sometimes leave a magic item behind (see the features above).
6. **Mind the piranha**: there's one in the river. It chases and bites you while you swim. Two log hits chase it off: throw from the bank as it comes close, or use a Log Shield.

If the game runs slowly on your phone, open ☰ → ⚙️ Settings and pick **Low** graphics. Settings is also on the start screen.

Your score unlocks bigger blueprints. The run lasts until your health runs out. Your score is on the leaderboard the whole time, so you don't have to finish a game for it to count.

## 🕹️ Controls

### Touch

| Control | What it does |
|---|---|
| **Joystick** (bottom middle) | **3rd person view:** up/down walks forward/back, left/right turns Chucky (the camera stays behind him). **Other views:** push where you want to go on the screen. |
| **🤿 Dive** (bottom left, in water) | Hold to dive, release to float back up. Watch the breath bar. |
| **🪵 Throw** (bottom left, on land) | **Tap** for a short toss (about 4 m, good for a wolf right in front of you), or **hold** to throw faster and higher: 1.2 seconds is a lob of about 55 m. While you hold, a dotted line and a ring show where the log will land. **Release** to throw. Costs 1 log; you can throw about every 0.6 seconds. Each throw flies a little off the aim and spins randomly. |
| **Zoom slider** (right edge) | Slide up to move the camera closer, down to move it further away. Double-tap the slider to reset. |
| **🏗️ / ✅ / 💥** (top right) | Opens the build menu. Becomes ✅ to **place** while building. Next to a structure it becomes 💥: **hold** it to demolish (you get 80% of the logs back). |
| **✖️** | Stop building. |
| **📷** | Switch the camera: 3rd person → Overview → Top-down → Cinematic. |
| **☰** | Menu: Resume, Save, Load, Leaderboard, Settings, New game. Opening it pauses the game. In a joint game: Resume, Players, Leaderboard, Settings, Leave game (it doesn't pause). |
| **Building controls** (left edge, while building) | ↻ / ↺ rotate the structure, **✅ PLACE** places it (green = OK, grey = not possible here), ✖ stops building. The label above shows the blueprint, its cost and why a spot isn't allowed. |

### Keyboard & mouse

| Key | What it does |
|---|---|
| **W A S D** / **arrow keys** | Move (in 3rd person: W/S forward/back, A/D turn) |
| **Space** | In the water: hold to dive. On land: hold to aim a throw, release to throw |
| **F** | Hold to aim a throw, release to throw |
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
| `blueprints.ts` | The 10 blueprints: dams, lodges and food caches built from logs, sticks (scaled-down logs) and mud, sized to exactly their cost. |
| `store.ts` | All game state and rules (Zustand): world generation, chomping, logs, combos, power-ups, building, demolition, saving and loading, leaderboard sync, camera mode and zoom. Gameplay tuning constants are at the top of the file. |
| `components/Woodchuck.tsx` | The player: movement, collisions, swimming and diving, chomping, the placement preview, and the model. |
| `components/Game3D.tsx` | The scene: canvas, cameras, day/night lighting, time and destruction managers, food, mobs, grass, graphics quality, environment-sound updates. |
| `components/DevPanel.tsx` | The 🛠️ dev menu (`npm run dev` only): power-up and magic switches and test helpers. |
| `components/InviteQR.tsx` | The invite QR code for joint games (link with the Wi-Fi address and room code), and reading `?join=` when an invite is opened. |
| `components/Magic.tsx` | The river piranha (swims, chases, bites), magic items (float, pick up, expire) and the Log Shield (hits animals; rivals' shields hurt you in joint games). |
| `components/WorldObjects.tsx` | Trees, boulders, loose logs (debris bundles), placed structures (instanced) and the placement preview. |
| `components/Controls.tsx` | Joystick, dive button, zoom slider, top-right buttons and keyboard/mouse input. It writes to `window.woodchuckInput`. |
| `App.tsx` | HUD, combo display, power-up pills, notifications, build menu, placement panel, in-game menu, settings, start and game-over screens, leaderboard. |
| `services/facts.ts` + `public/chucky-facts.json` | Chucky's speech bubble. The JSON holds the intro tips and the facts, each with an optional `when` condition (logs, trees, score, day, built, throws, chased, swim = times in the water, night = nights seen, bitten = piranha bites). Seen facts are remembered on the device. |
| `services/audio.ts` | Synthesized sound (no audio files) on three channels that can be muted separately: music, environment and sound effects. |
| `services/persistence.ts` | localStorage saves (3 slots), player name, camera zoom, graphics quality, sound settings, and the leaderboard client (shared API with a fallback to each device). |
| `server/leaderboardApi.ts` | Vite plugin: `GET` and `POST /api/leaderboard`, stored in `data/leaderboard.json`. |
| `server/multiplayerServer.ts` | Vite plugin: the joint-game WebSocket server at `/ws/chucky`. It handles rooms and codes, and keeps each room's shared world (seed, trees, logs, fruit, structures, clock). |
| `services/multiplayer.ts` | Joint-game client: connect, create and join, send our updates, and apply everyone else's to the store. Also has team colours and `canDemolish`. |
| `components/RemotePlayers.tsx` | The other players' Chuckies (smoothed movement, team scarf, name tag) and the per-frame network sync. |
| `globals.ts` | Shared mutable values read every frame without causing re-renders: player position and facing, live log and fruit positions (used by saves). |

### Key design decisions

- **Physics positions.** @react-three/cannon moves a body by writing its object's matrix; `object.position` keeps the spawn point. Read live positions with `readBodyPosition` / `readBodyTransform` from `globals.ts`.
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

### Editing Chucky's facts

Open `public/chucky-facts.json`, change or add entries, and reload the game; there's no need to rebuild. Each entry has a unique `id` and a `text`. Entries in `intro` play one after another at the start of your first solo game. Entries in `facts` show up one at a time (in solo games only), at most one every 40 seconds, each once per device. A fact's `when` is what the player must have reached first, for example `{ "trees": 3 }` or `{ "swim": 1, "logs": 10 }`. Facts without `when` come up every few minutes. Mistakes such as a missing id or an unknown `when` key are skipped, with a message in the browser console. The `_readme` at the top of the file explains every key.

### Joint games architecture

- **Shared world from a seed.** The server keeps the room's world seed and what changed since. A joining client runs `startGame(seed)` and then applies a snapshot.
- **Physics runs on every device.** The player who created a log (by felling, throwing, demolishing or being knocked out) is its *owner* and sends its position four times a second. Other devices snap a log back if it's more than 0.75 m off. A dropped log's launch velocity is part of its data, so it flies the same way everywhere.
- **First come, first served.** Picking up a log or fruit, or catching a team mate's throw, asks the server first (`take`). Only the first request is granted. A tree is felled by the first `fell` message; a later one is rejected, and that client removes the logs it spawned.
- **The victim decides hits.** Each device checks thrown logs from other players against its own Chucky, using the same swept hit test as for animals, and reports `hit`. This keeps hits fair on the screen of the player being hit.
- **Smoothed movement.** Other players send their position 10 times a second, and they're drawn 120 ms in the past so movement between updates is smooth. That data never goes through React; only joins, leaves, scores and knock-outs update the store.
- **Day and night stay in step.** The room's host sends the clock every 5 s, and clients correct any drift. If the host leaves, another player takes over.

### Useful tuning knobs

- `store.ts` (top): tree and boulder counts, food drop chance, power-up durations, combo windows, build points, debris limits, leaderboard sync interval.
- `blueprints.ts`: unlock scores, and each blueprint's name, cost, icon, description and shape (dam length and height, lodge size, entrances).
- `Woodchuck.tsx` (top): walk and swim speed, acceleration, turn and steer rates, diving and breath, chomp damage and reach, placement spacing.
- `Game3D.tsx`: `QUALITY_SETTINGS` and `GRASS_QUALITY` (what each graphics setting does), `GRASS_TILE`, and the camera constants (`CHASE`, `OVERVIEW`, `TOP_DOWN_VIEW`, `CINEMATIC_VIEW`).
- `services/audio.ts` (top): river, wind and underwater sound levels.
- `store.ts` and `server/multiplayerServer.ts`: knock-out time, throw damage and knock-back, players per room, how long empty rooms are kept.

### Dev menu

`npm run dev` starts Vite in mode `devtools`, which adds a dashed 🛠️ button on the left of the game screen. It opens a panel where you can:
- switch each power-up (Mega Chomp, Magnet, Zoomies) and each magic (Log Shield, Triple Chuck, Bubble Breath, Golden Teeth) on or off, with its countdown;
- drop a magic item in front of Chucky, move the piranha into the river level with him, or spawn a wolf or bear 8 m away (they only stay at night, so a solo game jumps to night);
- add 50 logs, heal to full, or jump to night or day (solo games only; a joint game's clock comes from the room).

`npm start` and production builds don't show the button: `App.tsx` renders it behind `import.meta.env.DEV && import.meta.env.MODE === 'devtools'`, so it's left out of the build. Everyone who opens the game from an `npm run dev` server (also on your Wi-Fi) gets the button, so use `npm start` for real games.

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
