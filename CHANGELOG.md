# Changelog

All notable changes to Woodchuck Dam Builder 3000 (*Chucky*). Newest first.

## 2026-10-31: Regression fixes and new features (rounds 1–5)

About 50 earlier commits had left the game in a bad state: Chucky moved far too fast, and the chomp meter appeared but trees never took damage. This series fixes the regressions and then adds the features requested during play-testing on a phone. Every round was type-checked (`tsc`: 0 errors), built with `vite build` and tested in a headless browser before delivery.

### Round 5: Cameras, zoom slider, documentation

**Cameras.** Before this round no camera followed from behind, and three of the four views were nearly the same high, south-facing angle. There are now four distinct views (📷 cycles them):
- **3rd person** (new default): a real chase cam behind and slightly above Chucky that swings round as he turns. When a tree would block the view, the camera slides in front of it and eases back out afterwards.
- **Overview**: the high three-quarter view from the south.
- **Top-down**: a map view from straight above.
- **Cinematic**: a slow, low orbit around Chucky (it used to be a fixed side view).
- The mode name pops up briefly when you switch.
- The camera never dips below the terrain (including hills behind Chucky) or below the water surface.

**Steering in 3rd person.** In the chase view the joystick steers: left/right turns Chucky and up/down walks forward/back (backwards at half speed). A/D and W/S work the same way. A full diagonal push gives full turn and full speed. After play-testing, the turn speed was lowered to 1.8 rad/s (a full circle takes about 3.5s) and given a response curve, so small stick pushes make gentle course corrections. This only affects 3rd person (`STEER_RATE` in `Woodchuck.tsx`). The other views keep the old camera-relative controls.

**Zoom.**
- A vertical **zoom slider** on the right edge of the screen: + at the top is closer, − at the bottom is further. Double-tap to reset.
- The **mouse wheel** zooms on a laptop. It is ignored while a menu is open, so menus can still scroll.
- Zoom scales every camera view (0.45x–2.2x) and is remembered on the device (`chucky.cameraZoom`).

**Documentation.** README rewritten (features, setup, shared leaderboard, how to play, full controls, developer notes), and this changelog added. `helperfiles/movement_fix_summary.md` now points to both.

Files: `components/Game3D.tsx`, `components/Woodchuck.tsx`, `components/Controls.tsx`, `store.ts`, `services/persistence.ts`, `README.md`, `CHANGELOG.md`, `helperfiles/movement_fix_summary.md`.

### Round 4: Shared leaderboard, big-structure performance

**Shared leaderboard.** The leaderboard used to be stored per device, so a phone never saw the laptop's scores.
- New `server/leaderboardApi.ts` (Vite plugin, registered in `vite.config.ts`) serves `GET` and `POST /api/leaderboard` from the dev and preview server.
- Scores are stored in `data/leaderboard.json`, with atomic writes, input sanitising and the top 100 kept. `data/` is git-ignored.
- The client pushes the live run to the server and shows the shared board, refreshing every 3s.
- It falls back to the device's own board when the server can't be reached, and the screen says which board you're looking at (🌐 / 📱).
- The first time a device connects, its old local scores are uploaded once.

**Performance with large structures.**
- Each placed structure is now **one instanced draw call**; it used to be 3 meshes per log.
- Physics uses one box per log for small structures and one box per layer for big ones, instead of a convex cylinder per log.
- The placement preview is one instanced see-through mesh, instead of a mesh plus outline per log.
- Logs only message the physics worker when their damping changes; before, they sent 2 messages per log every frame.
- Measured in the test browser: preview 0.83 → 4.5 fps, after placing the Woodchuck Palace 0.67 → 2.33 fps.

**Demolition.**
- Demolishing drops at most **12 log bundles**, each worth several logs and drawn bigger with twine bands. Before, it could spawn up to 3,072 physics logs.
- The bundles appear within about 0.5s; before, it could take over 2 minutes before the last log could be picked up.
- Hold-to-destroy time is capped at 8s.
- Bundles add their full value to wood and the log count, and log milestones can't be skipped by a big bundle.

Files: `server/leaderboardApi.ts` (new), `vite.config.ts`, `.gitignore`, `types.ts`, `services/persistence.ts`, `store.ts`, `App.tsx`, `components/WorldObjects.tsx`.

### Round 3: Live leaderboard, dive button position, building placement

**Live leaderboard.**
- The current run is written to the leaderboard automatically as you play, every 2s at most and only when something changed. It is also written when you open the menu and at game over.
- The HUD shows your current rank (#n). A run keeps updating its own entry, including after save and load.

**Dive button** moved to the **left** side, because the right thumb is on the joystick.

**Building placement.**
- The preview is pushed out by the blueprint's footprint, so big structures no longer land on top of Chucky.
- The preview turns **red** when placement isn't possible (not enough wood, too close to another structure, off the map) and shows the reason. It is green when the spot is valid.
- A placement panel has ↺ / ✅ PLACE / ↻ and *Stop building*. Rotation is actually applied. Keyboard: R/E rotate, Q rotates back, Enter places.
- You keep placing while you can afford another of the same structure.
- Building scores points per log (2 on land, 5 in the river). **Demolishing takes those points back**, so placing and destroying can't be farmed.
- Low or sunken structures don't block Chucky from swimming over them.

**Combo.**
- Combo timing is driven by the store; before, the HUD and the store used different, contradictory rules.
- Every log restarts the window: 20s / 15s / 12s / 10s for 1x–4x, with +1 multiplier per 2 logs.

**Misc.** Removed the link to a missing `/index.css` (it was a 404 in the console).

Files: `store.ts`, `App.tsx`, `types.ts`, `services/persistence.ts`, `components/Woodchuck.tsx`, `components/Controls.tsx`, `components/WorldObjects.tsx`, `components/Game3D.tsx`, `index.html`.

### Round 2: Zoomies, compact UI, game menu, saves, diving

**Zoomies power-up.** Eating 3 berries makes Chucky run and swim 1.6x faster for 20s. More berries while it's active extend it. A berry counter shows on the HUD.

**Smaller UI.**
- A compact HUD: health, wood, score, day, berries, tree bar, breath bar.
- Smaller buttons in one top-right row, power-up pills, and toasts that stay out of the way.

**Game menu (☰).**
- Resume, Save, Load, Leaderboard and New game. Opening the menu pauses the game, and resuming shifts every combo and power-up timer by the paused time.
- The start screen has a name field, Start, Load and Scores. The game-over screen shows your rank and the leaderboard.

**Save and load.**
- Three slots per device in localStorage.
- Worlds are now **seeded**, so a save is small: the seed plus what changed (tree health, felled trees, structures, unlocked blueprints, logs and fruit where they really are, player position and facing, power-up timers).

**Diving.**
- Hold 🤿 (or Space) in the water to dive and fetch sunk logs and fruit.
- Breath lasts 10s and refills when you surface. When it runs out you start drowning.

**Other fixes.**
- Logs that drift off the map down the river expire instead of falling out of the world.
- Logs restored from a save don't do the spawn "pop".

Files: `store.ts` (rewritten), `App.tsx`, `components/Controls.tsx`, `components/Woodchuck.tsx`, `services/persistence.ts` (new), `globals.ts`, `types.ts`, `components/WorldObjects.tsx`, `components/Game3D.tsx`.

### Round 1: Core regressions (speed and chomping)

**Chomping didn't work.** `Woodchuck.tsx` found the nearby tree and showed the chomp meter (`setActiveTree`), but **never called `damageTree`**. Physics contact events can't stand in for it either: a kinematic player never generates contacts with static trees, and the manual push-out kept Chucky off the trunks anyway. Chucky now chomps the closest trunk within reach directly (`CHOMP_DPS` 100 HP/s, `CHOMP_REACH` 0.7), and **Mega Chomp** hits every tree within 12 units.

**Chucky was far too fast.** He walked at 22 units/s and swam at 12, with no acceleration. Now he walks at 10 and swims at 7, with acceleration and deceleration. Turning, terrain following and bobbing are frame-rate independent, and long frames are clamped so he can't teleport after a hitch.

**Collisions** now use each trunk's real radius, boulders only block when they stick up to Chucky's height, and structures collide per log instead of with one big circle.

**Respawn.** *Try again* actually respawns Chucky and fully resets the run (power-ups, placement, demolition, blueprints, chomp history).

**Day and night.**
- One source of truth for night (`isNightTime`); lighting, mob spawning and the ghost light used to disagree.
- The game starts in early morning with the sun already up.
- Mobs spawn on the terrain (not inside hills) and never in water, with at most 5 at a time.

**Performance.**
- The player and `App` subscribe with selectors; before, they re-rendered on every store change, which was every frame while chomping.
- Per-frame store actions no longer wake every subscriber when nothing changed.
- Clouds load inside an error boundary, so a failed cloud texture download no longer crashes the whole game.

**Smaller fixes.** Missing type imports, notifications without ids, tree health shown as a real percentage, combo hint text matching the rules, and pick-up of logs by distance (as a fallback to physics contacts).

Files: `components/Woodchuck.tsx`, `components/Game3D.tsx` (rewritten), `store.ts`, `App.tsx`, `components/WorldObjects.tsx`.
