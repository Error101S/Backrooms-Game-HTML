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
flooded area, green carpet room, gray concrete area), denoises the result, decomposes it into
axis-aligned floor/ceiling rectangles and merged wall runs, and scatters ceiling light fixtures —
all in the blueprint's exact relative proportions. That output is `game/assets/map/runtime_map.json`,
loaded at runtime by `src/world/MapData.js`. Re-run the tool any time the source image changes.

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
ceilings, walls, baseboards, water, light panels) via `world/GeometryBatcher.js`, so the whole
level renders in well under 30 draw calls regardless of its size.

### VHS Camcorder Mode

Toggle with `V` or the pause menu. It:
- picks a random in-fiction recording date between **1972 and 1997** and ticks a camcorder-style
  timestamp overlay,
- applies a fisheye/barrel lens warp,
- pushes bright fluorescent whites toward a warm tape-yellow (the level's actual lights stay
  plain white — the yellow is purely a tape-stock color response, exactly like the reference
  found-footage clip),
- adds scanlines, interlace flicker, chroma smear, grain, and occasional dropout streaks.

### Textures

`game/assets/textures/` holds resized/recompressed copies of the PBR (color/normal/roughness)
texture set from `Downloads/backrooms/backrooms/` — carpet, drop-ceiling tiles (two variants),
painted wallpaper (two variants), and pool tiles — tiled in world units so they read at a
consistent scale no matter how large a given room is.
