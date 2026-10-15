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
            #   GameCanvas     – gyökér jelenet, click -> aktív eszköz
            #   TerrainSurface – EGYETLEN összefüggő heightmap terep-mesh
            #                    (fű+domb+rámpa+víz+város) + a kattintás-hitbox
            #   MapGrid        – erdő-dekoráció (fa-blokkok) a felszínen
            #   Industries     – auto-generált speciális épületek (fatelep/bánya/erőmű/gyár)
            #   BuildingIcons  – lebegő UI ikonok a speciális épületek fölött (drei Html)
            #   Roads          – utak (síkon, dombon megemelve)
            #   CityBuildings  – a város auto-épületei (szint = magasság)
            #   GridFloor      – vizuális referencia-rács (nem pick-sík)
            #   usePointerBuild.ts – megosztott click+drag kezelők (stopPropagation)
            #   CameraRig      – RTS kamera (drei MapControls)
            #   terrainStyle.ts / config.ts
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
- **Út ($10)** – út építése üres (fű) cellára **vagy** domb tetejére/oldalára
  (a dombon az út felveszi a lejtő dőlését és magasságát). **Húzva** is építhető:
  tartsd nyomva a bal gombot és húzd végig a cellákon.
- **Törlés** (bulldózer) – utak visszabontása üres talajjá; dombokat/vizet/
  várost/ipart **nem** lehet kitörölni.

> Az ipar (fatelep, bánya, erőmű, gyár) **magától generálódik** a térképen
> szétszórva, a várostól távol — a játékosnak **utakkal kell összekötnie**.

Bal felül látszik a **pénz** ($1000-ról indul), az **épületek** (ipar) és a
**lerakott utak** száma. Minden útépítés levonja az árat (ha nincs rá fedezet,
nem épül).

- **Bal gomb**: építés / törlés (kattintás vagy húzás) — a kamerát **nem** mozgatja
- **Mozgás (pan)**: WASD vagy nyílbillentyűk (sima, folyamatos)
- **Jobb húzás**: forgatás · **Görgő / középső gomb**: zoom

A rács `cellSize` értéke a `src/render/config.ts`-ben állítható.

### Terep

A **61×61-es** rács procedurálisan generált (nagy játéktér): a pontos közepén
5×5-ös városközpont, körülötte **ritkásan elszórt dombcsoportok** és sok
egybefüggő, sík, beépíthető fűterület, valamint víz és erdő. A dombok
**lépcsőzetes szinteken** emelkednek (szintenként `HILL_STEP = 0.45` egység,
a korábbi lépcső fele), egy összefüggő, hézagmentes low-poly rámpa-felszínen —
egy 2-es szintű magaslat éri el a korábbi 1-es szint magasságát. Dombra épített
út felveszi a domb magasságát.

A várost **nem zárhatják körbe** a dombok: a központ körül **5 cellás védőzóna**
teljesen hegymentes, és az **északi/déli** szélek mentén erősen csökkentett a
domb-esély, így mindig marad legalább két szabad terjeszkedési folyosó.

A teljes terep **egyetlen összefüggő heightmap-mesh** (`TerrainSurface`): a
geometria a sarok-maximum magasságtérképből épül (fű, domb, rámpa, víz, város),
cellánkénti lapos színekkel és low-poly árnyékolással. Mivel ez a tényleges
felszín, a **kattintás-hitbox is ezen van** — a raycaster mindig a valódi
felületet találja el (síkon és lejtőn is), nincs külön lapos pick-sík a dombok
alatt. Az utak, épületek és ikonok külön rétegként kerülnek rá a felszínre.

Generáláskor **automatikus ipar** jelenik meg: 3-3 **fatelep** (LumberMill 🪓),
**bánya** (Mine ⛏️), **erőmű** (PowerPlant ⚡) és **gyár** (Factory ⚙️). Az ipar
tematikusan a **nyersanyaga közelébe** kerül (fatelep az erdőhöz, bánya a
dombhoz, erőmű a vízhez; a gyár bárhová), de **szétszórva**: a várostól legalább
`INDUSTRY_CITY_GAP` cellára, és egymástól is legalább `INDUSTRY_MIN_SPACING`
távolságra — így sosem tornyosul egymásra vagy áll sorban, és a játékosnak
utakkal kell összekötnie őket. A speciális épületek fölött **lebegő UI ikon** jelenik meg
(drei `<Html>`), finom bobbing animációval, a könnyű azonosításhoz.
