# The Backrooms — Mapped Sector (playable 3D recreation)

A fully playable, first-person 3D recreation of the reference "currently mapped areas of the
Backrooms" blueprint, built with plain HTML + ES modules + [three.js](https://threejs.org) —
no build step, no bundler required to run it.

## Running it

Any static file server works, e.g. from this `game/` folder:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

or `npx serve .`. It must be served over HTTP (not opened as a `file://` URL) because the map
data and textures are loaded via `fetch()`.

## Controls

| Action | Key |
| --- | --- |
| Move | `WASD` / Arrow keys |
| Look | Mouse (click to lock the pointer) |
| Run | `Shift` |
| Crouch | `Ctrl` / `C` |
| Jump | `Space` |
| Interact | `E` |
| Toggle map overlay | `M` |
| Toggle VHS camcorder mode | `V` |
| Pause | `Esc` |

Touch devices get on-screen dual joysticks, jump/run buttons, and swipe-to-look automatically.

## How the map was built

`tools/build_map.js` (see the repo root) rasterizes the reference blueprint image, classifies
every pixel as inside/outside a room and by color-coded zone (tan hallway, pink office, blue
tiled area, green carpet room, gray concrete area), denoises the result, decomposes it into
axis-aligned floor/ceiling rectangles and merged wall runs, and scatters ceiling light fixtures —
all in the blueprint's exact relative proportions. That output is `game/assets/map/runtime_map.json`,
loaded at runtime by `src/world/MapData.js`. Re-run the tool any time the source image changes.

This is a plain, dry Backrooms — there is no water anywhere. The map's blue-coded zone renders
as a normal (dry) tiled floor using the `pool_tiles` PBR texture set purely as a flooring pattern,
not an actual pool/water feature.

## Architecture

```
src/
  core/        Game orchestration, render pipeline wiring, quality presets, lighting mood
  world/       Map data + collision grid, batched geometry builder, materials, ceiling lights,
               lore pickups
  player/      Input handling, first-person controller (movement/gravity/jump/collision/bob)
  fx/          VHS camcorder post-processing shader + controller
  audio/       Procedural WebAudio sound hooks (footsteps, hum, interact chime)
  ui/          HUD, pause/settings menu, touch controls, minimap
```

All ~300 mapped rooms are merged into a small, fixed number of draw calls per material (floors,
ceilings, walls, baseboards, light panels) via `world/GeometryBatcher.js`, so the whole
level renders in well under 30 draw calls regardless of its size. Wall segments are extended by
half their thickness at both ends before building geometry so that L/T corners fully seal (no
see-through gaps where two wall runs meet).

Ceiling light panels are lit via `InstancedMesh.setColorAt()` per-instance color, without setting
`vertexColors: true` on the shared material — that flag makes three.js require an actual
per-vertex `color` BufferAttribute on the geometry, and since none exists here it silently
multiplies every panel's color by black. Bloom (`UnrealBloomPass`, medium/high quality) and a
small pool of real `THREE.PointLight`s re-homed to the nearest fixtures each frame (see
`world/LightGrid.js`) provide the actual illumination and glow.

### Lens flares & bloom

`fx/LensFlares.js` attaches a small pool of `Lensflare` objects (three.js's built-in
screen-space-occluded flare/ghost object, from `vendor/three/examples/jsm/objects/Lensflare.js`)
to the ceiling fixtures currently lit by `LightGrid`'s point-light pool, so flares track whichever
lights are nearest the player and are naturally occluded by walls. `fx/PostFX.js` runs an
`UnrealBloomPass` after the base render (enabled on Medium/High quality) so the lit panels
actually glow instead of just being flat bright quads.

### VHS Camcorder Mode

Toggle with `V` or the pause menu. It combines an image-degradation shader pass with a DOM
viewfinder-HUD overlay to read as an actual camcorder recording, not just a color filter:
- **Shader pass** (`fx/VHSShader.js`): fisheye/barrel lens warp, pushes bright fluorescent whites
  toward a warm tape-yellow (the level's actual lights stay plain white — the yellow is purely a
  tape-stock color response, exactly like the reference found-footage clip), scanlines, interlace
  flicker, chroma smear, grain, and occasional dropout streaks.
- **Viewfinder HUD** (`fx/VHSController.js` + the `#vhs-hud` overlay in `index.html`): a blinking
  REC dot, a running `HH:MM:SS:FF` tape timecode counter (counts up from the moment VHS mode is
  switched on), an `SP · AUTO` deck-mode tag, a slowly-draining battery gauge, viewfinder corner
  brackets, and an in-fiction recording date/time (randomized between **1972 and 1997**) that
  ticks forward like the OSD clock a real camcorder burns into the tape, plus an occasional
  autofocus "hunt" bracket flash.

### Textures

`game/assets/textures/` holds resized/recompressed copies of the PBR (color/normal/roughness)
texture set from `Downloads/backrooms/backrooms/` — carpet, drop-ceiling tiles (two variants),
painted wallpaper (two variants), and pool tiles — tiled in world units so they read at a
consistent scale no matter how large a given room is.
