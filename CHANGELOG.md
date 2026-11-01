# Changelog

All notable changes to Woodchuck Dam Builder 3000 (*Chucky*). Newest first.

## 2026-10-31 – 2026-11-01: Regression fixes and new features (rounds 1–13)

About 50 earlier commits had left the game in a bad state: Chucky moved far too fast, and the chomp meter appeared but trees never took damage. This series fixes the regressions and then adds the features requested during play-testing on a phone. Every round was type-checked (`tsc`: 0 errors), built with `vite build` and tested in a headless browser before delivery.

### Round 13: Magic drops, Log Shield and the river piranha

**Magic items.** Chased-off animals drop a glowing, floating magic item: wolves 30% of the time, bears 50%, and piranhas always. Walk into it to get one of these:
- 🛡️ **Log Shield** (20 s): six logs orbit Chucky. They bonk wolves, bears and piranhas, and rival players in joint games (10 damage plus a knock-back). Team mates are safe.
- ✨ **Triple Chuck** (25 s): every throw launches three logs. The two magic ones glow, can't be picked up, and vanish 3.5 s after the throw, so there's no free wood.
- 🫧 **Bubble Breath** (30 s): endless air underwater.
- 🌟 **Golden Teeth** (30 s): felled trees drop twice the logs.

Items float for 60 s and blink before they vanish. Active magic shows as a pill under the buttons, and it doesn't run out while a solo game is paused. Picking up the same magic again adds more time.

**River piranha.** One piranha lurks in the river from the start.
- It wanders up and down with its dark red fin poking out of the water, and it never leaves the river.
- It chases you if you swim within about 22 m, at a little slower than you swim.
- It bites for 8 damage while you're in the water.
- Two log hits, from a throw or the Log Shield, chase it off for 50 points and a guaranteed magic item. Another one turns up 3 to 5 minutes later.
- Like wolves and bears, each player has their own.

**Chucky's facts.**
- `swim` now counts how many times you've gone into the water, and `night` counts nights. Facts like `"swim": 2` used to wait forever, because these were yes/no.
- A new `bitten` key counts piranha bites.
- A new piranha myth-buster shows after your first bite, and `chased` now counts piranhas too.

**Joint games.** A rival's Log Shield is visible and checked against your own Chucky. Triple Chuck's magic logs travel to the other players too.

Files: `components/Magic.tsx` (new), plus `types.ts`, `store.ts`, `App.tsx`, `components/Game3D.tsx`, `components/Woodchuck.tsx`, `components/WorldObjects.tsx`, `components/RemotePlayers.tsx`, `services/multiplayer.ts`, `server/multiplayerServer.ts`, `services/facts.ts`, `public/chucky-facts.json`, `README.md`, `CHANGELOG.md`.

### Round 12: Chucky the beaver and his fact nuggets

**Chucky is a beaver.** Woodchucks (groundhogs) don't fell trees or build dams; beavers do.
- The start screen now says **Chucky the Beaver**.
- His list of instructions is gone, replaced by a short hello from Chucky.
- His model has a flat paddle tail and orange front teeth (beaver enamel has iron in it), and other players' Chuckies look the same.

**Chucky's speech bubble.** At the start of your first game, Chucky explains the game, beginning with: *"By the way, I'm a beaver! Woodchucks don't actually 'chuck wood' LOL! My first fact nugget for you!"*
- **As you play:** he shares beaver facts and myth-busters, triggered by progress such as trees felled, logs, swimming, the first night, structures built, throws, wolves chased off, score or day.
- **Pacing:** facts come at most one every 40 seconds, and each one only once per device.
- **Pausing:** a solo game pauses while the bubble is open; joint games don't pause.
- **Controls:** Next ▶ / Skip, or Enter / Esc.
- **Menu and Settings:** ☰ → 🦫 Chucky's tips replays the intro. ⚙️ Settings has a switch for fact nuggets and a button to hear all the facts again.

**Editable facts.** All the text is in `public/chucky-facts.json`. Edit it and reload the game; there's no need to rebuild.
- **Validation:** entries are checked when the game loads. Problems are skipped, with a message in the console.
- **Fallback:** if the file can't be loaded, Chucky still gives his first line.

**Short taps and spinning logs.** Holding the throw button now builds up speed as well as height:
- a quick tap is a short toss of about 4 m, for wolves and bears close by
- 1.2 s gives a lob of about 55 m

Scatter is smaller on short tosses. Every thrown log spins randomly, and in a joint game it spins the same way for everyone.

Files: `public/chucky-facts.json` and `services/facts.ts` (new), plus `types.ts`, `store.ts`, `App.tsx`, `components/Controls.tsx`, `components/Game3D.tsx`, `components/WorldObjects.tsx`, `components/Woodchuck.tsx`, `components/RemotePlayers.tsx`, `services/multiplayer.ts`, `server/multiplayerServer.ts`, `README.md`, `CHANGELOG.md`.

### Round 11: Aimed throws

**Hold to aim.** Hold 🪵 (or Space/F on land) to aim, then release to throw. The longer you hold, the higher the throw:
- a quick tap is a flat throw of about 20 m
- a full 1-second charge is a lob of about 50 m

The button fills up while you hold it. Walking into the water while aiming cancels the throw.

**Throw guide.** While you aim, a dotted line shows the flight path and a ring marks where the log will land. It uses the same gravity, air drag and time step as the physics engine.

**Scatter.** Every throw flies a little off the aim: up to ±1.2 m/s high or low, ±3° left or right, and ±6% long or short. No two throws follow exactly the same path. Other players see the real path in joint games.

Files: `globals.ts`, `store.ts`, `components/Controls.tsx`, `components/Game3D.tsx`, `README.md`, `CHANGELOG.md`.

### Round 10: Joint games (multiplayer on the same Wi-Fi)

**Lobby.** On the start screen, **👥 Play together** lets you enter your name and pick a team (Red, Blue, Green, Yellow or Solo). From there you can **Create a game**, which gives a code like BARK-27, or **Join** with a code. Up to 8 players per game.

**One shared world per room.**
- **Same world:** everyone gets the same world from the room's seed.
- **Shared changes:** tree damage, felled trees, loose logs, fruit, structures and the day/night clock are the same for everyone.
- **Racing:** whoever reaches a log or a piece of fruit first gets it.
- **Late joiners** get the world as it is now.

**Players.**
- **Look:** other players' Chuckies wear a team-coloured scarf, have a name tag, and move smoothly. Their swimming, diving, chomping and knock-out poses are shown too, and your own Chucky wears your team colour.
- **HUD:** shows the room code and how many players are in the game.
- **Feed:** a short feed shows joins, leaves, bonks, catches and knock-outs.

**Throwing at players.** A thrown log hits rivals for 20 damage plus a knock-back. A team mate catches it instead and gets the wood. Hits are decided on the screen of the player being hit.

**Knock-outs.** You drop half your logs as bundles for others to grab, and they give wood only, so they can't be farmed for score. You lie still for 5 seconds, then get up at the river bank with your score kept. You can't throw or chomp while knocked out.

**Structures.** Each structure records who built it and their team. You can demolish your own and your team's, but not a rival's, and you only lose points for your own.

**Other joint-game rules.**
- **No pausing:** menus don't pause the game, because the world goes on for everyone.
- **No save or load:** saving and loading are off.
- **Menu:** shows Players, Leaderboard, Settings and **Leave game**.
- **Lost connection:** the game says so and you can rejoin with the same code.
- **Wolves and bears:** each player has their own.

**Server.** `server/multiplayerServer.ts` runs inside the Vite dev/preview server (WebSocket `/ws/chucky`) and adds the `ws` package (`npm install`).
- **Validation:** every message is checked: sizes, numbers, ids and names.
- **Cleanup:** empty rooms are forgotten after 10 minutes.
- **First come, first served:** it decides who gets a log, a piece of fruit or a tree first.

**Smaller changes.** Logs dropped by felling or demolishing now carry their launch velocity in their data, so every player sees them fly the same way.

Files: `server/multiplayerServer.ts`, `services/multiplayer.ts` and `components/RemotePlayers.tsx` (new), plus `package.json`, `vite.config.ts`, `types.ts`, `globals.ts`, `store.ts`, `App.tsx`, `components/Game3D.tsx`, `components/Woodchuck.tsx`, `components/WorldObjects.tsx`, `README.md`, `CHANGELOG.md`.

### Round 9: Throwing logs

**The throw button.** On land, a 🪵 **Throw** button sits where the 🤿 dive button is in the water, under the left thumb. On the keyboard, Space throws on land (and still dives in the water), and F throws too.

**How a throw works.**
- A throw costs 1 log, with a 0.6 s cooldown.
- The log flies the way Chucky faces, spinning, with real physics, so it bounces off trees, rocks and structures.
- After play-testing, throws were made much stronger: about 30 m on flat ground (it was about 10 m). The hit test now checks a tall zone around each animal along the log's path, so close and far throws both connect.

**Hitting wolves and bears.** A log that hits a wolf or bear while it's still flying fast knocks the animal back and dazes it for a moment (it flashes red and stops attacking). A wolf runs off after 2 hits (+20 points) and a bear after 3 (+40).

**Picking thrown logs up again.** A thrown log lands as a normal pick-up, but it only gives back +1 wood: no score, combo or log count. That way, throwing and re-collecting can't be farmed, even after saving and loading.

**Bug fix: physics positions.** The physics engine moves a body by updating its transform matrix, but much of the game read the body's position field, which kept the spot where it spawned. Everything below now reads the real, live position:
- Pick-up by proximity, expiry when a log drifts off the map, and the log magnet. The magnet used to yank logs back to where they spawned.
- Picking up fruit.
- Wolves and bears now chase and bite from where they really are, and stop at the river bank properly.
- Saved games now store where logs and fruit really are, not where they spawned.

**Logs in the river.** The old floating-log code never actually ran for logs dropped on land, and for debris in the river it pushed logs up into the sky. Logs therefore sink slowly to the river bed, which matches how the game has always played (dive to fetch them). They now also get a wet look underwater.

**Groundwork for multiplayer.** Thrown logs and animals are registered so the next round can check hits against other players.

Files: `types.ts`, `globals.ts`, `store.ts`, `services/persistence.ts`, `services/audio.ts`, `components/WorldObjects.tsx`, `components/Game3D.tsx`, `components/Controls.tsx`, `README.md`, `CHANGELOG.md`.

### Round 8: Build ghost drawn in the right order

The see-through preview had depth testing switched off and was drawn last, so it was painted over everything, including Chucky standing in front of it.
- It is now depth-tested, so Chucky, trees, rocks and terrain in front of it hide it, just as they would hide a real structure.
- It writes depth, so grass behind it no longer shows through.
- It is drawn before the water, so the parts below the river surface are still visible through the water.

Files: `components/WorldObjects.tsx`, `CHANGELOG.md`.

### Round 7: Building preview fix, placement controls out of the way

**Preview showed a single log.** After placing a structure, the preview of the next one (any blueprint) showed only one log.
- **Cause:** the preview mesh received its material as a constructor argument. When the preview switched between cyan and red, which happens straight after placing because the new spot is next to the structure, the mesh was rebuilt. Log positions were only written when the blueprint changed, so the rebuilt mesh had every log at the same spot.
- **Fix:** the material is now a normal property, so changing colour no longer rebuilds the mesh, and the log positions are written again whenever the mesh is rebuilt for any reason.

**Placement controls out of the way.** The building panel sat at the bottom centre, right over Chucky in the 3rd-person view.
- The controls are now a slim column on the left edge, where the left thumb can reach them: ↻, a big ✅ PLACE, ↺ and ✖.
- A small label above the column shows the blueprint, its cost and why a spot isn't allowed.
- The ✅ and ✖ buttons in the top-right row still work too.

Files: `components/WorldObjects.tsx`, `App.tsx`, `README.md`, `CHANGELOG.md`.

### Round 6: Grass near Chucky, graphics quality, sound settings

**Grass only around Chucky.** Before, 40,000 grass blades were scattered over the whole map and all of them were drawn every frame.
- Grass is now drawn only in a window of 12 m tiles around Chucky.
- Each tile's blades come from the tile's coordinates, so you see the same grass when you come back.
- When Chucky walks into a new tile, only the row of tiles that came into range is rebuilt and uploaded to the GPU.
- Blades shrink into the ground near the edge of the window, so there's no visible border.
- Blades now stand on the ground; before, short ones floated and tall ones were partly buried.

**Graphics quality** (☰ → ⚙️ Settings, or on the start screen). Phones and tablets default to Medium and computers to High, until the player picks one; the choice is saved on the device.
- **Low**: 1,125 grass blades (out to about 24 m), pixel ratio 1, 512 shadow map, no clouds.
- **Medium**: 4,860 blades (about the old density, out to about 48 m), pixel ratio up to 1.5, 1024 shadow map.
- **High**: 10,890 blades (denser, out to about 60 m), pixel ratio up to 2, 2048 shadow map.
- Changes apply immediately. Before, phones with sharp screens drew at 2x pixel ratio.

**Shadows.** The sun's and moon's shadow maps were both re-rendered every frame. Now each is only rendered while its light is up, which saves a whole shadow pass at any time of day.

**Sound settings.** Music, environment and sound effects can each be switched on or off. The settings are saved on the device, and a muted channel costs no CPU.
- **New environment sounds**: a river that gets louder near the water and is muffled under it, gentle wind, birds by day and crickets at night.
- **Fixes**: the volume control wasn't actually connected (every sound went straight to the speakers). The music could start twice and could never be stopped. Sounds scheduled while the tab was in the background burst out on return; audio now pauses in the background.

Files: `services/audio.ts` (rewritten), `types.ts`, `services/persistence.ts`, `store.ts`, `components/Game3D.tsx`, `App.tsx`, `README.md`, `CHANGELOG.md`.

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
- The preview turns **red** when placement isn't possible (not enough wood, too close to another structure, off the map) and shows the reason. It is cyan when the spot is valid.
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
