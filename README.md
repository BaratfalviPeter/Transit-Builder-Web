# Transit Builder Web

Egy 3D-s webes logisztikai / városépítő játék (Mini Motorways + makro-logisztika
hangulat). Stack: **React + React Three Fiber + drei + Three.js + Vite +
TypeScript**.

## Architektúra-elv

A szimulációs mag tiszta TypeScript, teljesen leválasztva a React/Three.js
rétegről:

```
src/
  sim/      # tiszta TS szimulációs mag (nincs React/Three)
            #   terrain.ts         – CellType enum, map modell + proc. generálás
            #   TerrainStore.ts     – mutálható, observable terep (út/ipar/bontás)
            #   useTerrain.ts       – TerrainProvider + hookok (map, útszám, …)
            #   tools.ts            – építési eszközök + áraik (adat)
            #   GameState.ts        – aktív eszköz + pénz
            #   useGameState.ts     – GameProvider + snapshot hook
            #   CityDevelopment.ts  – auto-spawn / szintlépő város (tick)
            #   useCityDevelopment.ts – játékciklus (setInterval) + snapshot
  render/   # R3F komponensek
            #   GameCanvas    – gyökér jelenet, click -> aktív eszköz
            #   MapGrid       – sík terep-csempék (instancing, típusonként)
            #   Hills         – lankás, trapéz alakú dombok (egyedi geometria)
            #   Roads         – utak (síkon, dombon megemelve)
            #   CityBuildings – a város auto-épületei (szint = magasság)
            #   GridFloor     – pick-sík a kattintáshoz
            #   CameraRig     – RTS kamera (drei MapControls)
            #   hillGeometry.ts / terrainStyle.ts / config.ts
  ui/       # React overlay
            #   Hud      – pénz + épület/út számlálók + hint
            #   Toolbar  – alsó-középső építési menü
  App.tsx
  main.tsx
public/
  models/   # ide kerülnek a .obj/.glb modellek (lásd models/README.md)
```

### Teljesítmény-elv

A sok mozgó jármű **nem** React re-renderen keresztül fog frissülni, hanem a
Three.js render-loopban (`useFrame`) + instancing-gal. A React csak a diszkrét
eseményekre (építés, bontás, város-növekedés) renderel újra, observable store-ok
+ `useSyncExternalStore` hookokon keresztül. A terep is típusonként egyetlen
`InstancedMesh`-sel rajzolódik.

## Futtatás

```bash
npm install
npm run dev        # fejlesztői szerver
npm run build      # típusellenőrzés + production build
npm run preview    # buildelt verzió kiszolgálása
```

## Játékmenet / vezérlés

Az alsó-középső **eszköztárból** választhatsz eszközt (az **Út** az
alapértelmezett):

- **Kijelölés** – semleges egér.
- **Út ($10)** – út építése üres (fű) cellára vagy domb tetejére.
- **Favágó ($150)** / **Bánya ($200)** – ipari épület üres cellára.
- **Törlés** (bulldózer) – utak és ipari épületek visszabontása üres talajjá;
  dombokat/vizet/várost **nem** lehet kitörölni.

Bal felül látszik a **pénz** ($1000-ról indul), az **épületek** és a **lerakott
utak** száma. Minden építés levonja az eszköz árát (ha nincs rá fedezet, nem
épül).

- **Bal húzás**: pásztázás · **Jobb húzás**: forgatás · **Görgő**: zoom

A rács `cellSize` értéke a `src/render/config.ts`-ben állítható.

### Terep

A 21×21-es rács procedurálisan generált: középen 5×5-ös városközpont, körülötte
víz, erdő, érclelőhely és **lankás dombok** (OpenTTD-stílusú rézsútos rámpák).
Dombra épített út felveszi a domb magasságát.
