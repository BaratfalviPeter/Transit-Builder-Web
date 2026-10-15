# Models

Place `.obj` / `.glb` building and vehicle models here. They are served from
the root at runtime, e.g. a file at `public/models/house.glb` is available at
`/models/house.glb`.

## In use

- **`Untitled.glb`** — the power plant model, loaded by
  `src/render/PowerPlantGLTF.tsx` (drei's `useGLTF`) and rendered for every
  `PowerPlant` cell by `src/render/Industries.tsx`. It is auto-fitted: the
  loader measures the model's bounding box, scales it to a target footprint,
  and lifts it so its base rests on the cell surface — so the raw model's size
  (~60 units) and origin don't matter.

## Swapping / adding models

The power plant uses the swappable loader `PowerPlantGLTF.tsx`. To replace it,
drop a new `.glb` here and update `MODEL_URL` in that file (or add a new loader
component for another building type, following the same auto-fit pattern). The
procedural `PowerPlantModel.tsx` remains as the Suspense fallback.
