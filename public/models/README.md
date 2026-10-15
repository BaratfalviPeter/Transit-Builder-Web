# Models

Place `.obj` / `.glb` building and vehicle models here. They are served from
the root at runtime, e.g. a file at `public/models/house.glb` is available at
`/models/house.glb`.

## Swapping placeholder boxes for real models

The entire visual representation of a placed object goes through a single,
isolated component: `src/render/BuildingModel.tsx`. It currently renders a
placeholder box. To use a real model:

1. Drop the asset in this folder (e.g. `house.glb`).
2. In `BuildingModel.tsx`, load it (drei's `useGLTF` for `.glb`, or
   `useLoader(OBJLoader, ...)` for `.obj`) keyed by `PlaceableKind` and render
   `<primitive>` instead of the `<boxGeometry>`.
3. Keep the same props and a ~1-cell footprint so no caller needs to change.
