# Backrooms-Game-HTML

A playable 3D recreation of the "currently mapped areas of the Backrooms" reference blueprint.

▶ **The game lives in [`game/`](./game) — see [`game/README.md`](./game/README.md) to run it and
for full controls/architecture notes.**

Quick start:

```bash
cd game
python3 -m http.server 8080
# open http://localhost:8080
```

## Repository layout

- `game/` — the playable 3D game (HTML + ES modules + three.js, no build step).
- `tools/build_map.js` — offline pipeline that turns the reference blueprint PNG into the game's
  runtime map data (`game/assets/map/runtime_map.json`). Re-run it if the source image changes.
- `dm8x0hp-63857b27-e7e8-4bdd-aa12-0971a763eafd.png` — the reference map layout (authoritative
  blueprint for the game's geometry).
- `Found_Footage_-_Backrooms_1.webp` — reference still for the fluorescent lighting look
  reproduced in-game and in VHS Camcorder Mode.
- `Downloads/backrooms/backrooms/` — the original PBR texture set (color/normal/roughness for
  carpet, ceiling tiles, painted wallpaper, pool tiles) used to texture the level.
