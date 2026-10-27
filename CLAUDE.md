# CLAUDE.md: projektállapot és munkamenet-jegyzet

Ezt a fájlt a Claude Code minden munkamenet elején (és a kontextus tömörítése
után is) beolvassa. **Ha valamiben bizonytalan vagy, innen indulj**, és tartsd
naprakészen: minden lezárt rész után frissítsd az „Állapot” és a „Következő
lépések” részt.

## A projekt röviden
Magyar nyelvű, böngészős 3D logisztikai/városépítő játék (Transport
Tycoon-szerű). Domborzat, utak, sínek, iparágak, állomások, ipari belső nézet
(futószalagok, gépek), teherautó-járatok, bevétel.

- **Stack:** React 18 + React Three Fiber v8 + drei + three r169 + Vite + TypeScript
- `src/sim/`: tiszta TS szimuláció (megfigyelhető store-ok + `useSyncExternalStore`)
- `src/render/`: R3F 3D render (modellek, terep, járművek)
- `src/interior/`: ipari belső nézet (saját Canvas)
- `src/ui/`: DOM UI — `GameUI.tsx` (felső sáv, panelgombok, alsó eszköztár, oldalpanel:
  Járatok / Pénzügyek / Dev, súgó, gyorsbillentyűk). A régi SidePanel / Hud megszűnt.
- `src/dev/`: fejlesztői eszközök (modellszerkesztő, modellnéző, perf mérő)
- `dev/modelEditorPlugin.ts`: Vite-plugin, a szerkesztő ezen át írja vissza a `.tsx` forrást
- `ötletek.md`: későbbre félretett ötletek (a felhasználó kérte)

## Együttműködési szabályok (a felhasználó kérései)
- **Magyarul** válaszolj.
- Ezt a `CLAUDE.md`-t **magadtól frissítsd**, amikor jónak látod (új funkció, új
  szabály vagy tény, változott állapot). Nem kell hozzá engedélyt kérni.
- Fejlesztési ág: `claude/gallant-archimedes-4snxvs`. Ide commitolj és pusholj.
- **PR-t magadtól nyiss**, ha kész egy rész. A PR leírása **magyarul, vázlatosan**
  (pontokba szedve, nem túl részletesen).
- Ha a PR-t már mergelték: `git fetch origin && git checkout -B claude/gallant-archimedes-4snxvs origin/main`,
  és új PR-t nyiss. Ha még nyitva van, az új commit oda kerül: frissítsd a címét és a leírását.
- Git e-mail: a GitHub noreply címet használd (a privát e-mail miatt a push GH007 hibát ad).
- A felhasználó **Macen** játszik (retina, 120 Hz), a teljesítmény ott számít.

## Fontos technikai tények
- Rács: 121×121 cella (GRID_SCALE 2), cellSize 1. A nagy iparágak 6×6-os telken
  állnak, a modellek 3×3-ra készültek, és `INDUSTRY_MODEL_SCALE = 2`-vel skálázódnak.
- Sín: sima középvonal-hálózat (`railNet.ts`). Rácsos A* tervező (`railRoute.ts`):
  8 irányú egyenesek, 45°-os ívek, sugaruk k(1+√2).
- Állomás/megálló: az iparág oldalán (`stations.ts`, Side N/S/W/E, StopKind rail|truck).
  Ára: vasútállomás $500, kamionmegálló $300.
- **Termelés most FIX** (`FIXED_PRODUCTION`, `production.ts`): bánya érc 0,5/s, fatelep
  deszka 0,5/s, olajfúró olaj 0,4/s, gyár deszka→áru max. 1/s, erőmű éget max. 2/s.
  Csak megállóval rendelkező ipar termel, a legüresebb megállóba (kapacitás 100).
- **Belső (mikro) nézet kikapcsolva** (`INTERIORS_ENABLED = false`, `interior.ts`): a
  felhasználó kérésére, előbb a szállítás legyen jó. A kód megvan (12×12 rács, gépek,
  szalag 1,5 mező/s), később visszajön.
- Járatok (`transport.ts`): teherautó $1500, 20 egység, sebesség 3. Fizetés:
  egység × érték × (1 + táv/25). Hálózati nézet metrótérkép-stílusban
  (`Transport.tsx`, szürke fátyol, a vonalak egymás mellett futnak). A vonalak,
  megállók és kamionpöttyök az út fölött 0,12 cellával, mélységteszt nélkül (a fátyol
  fölött látszanak), világegységben 0,38 cella szélesen.
- Kamionok: csuklós (`TruckModel.tsx`: `Tractor` / `Trailer`, origó a nyeregnél, 5 háló /
  kamion), sávpálya `buildLane` (jobb sáv 0,2, kanyarív), `pose` → nyereg, vontató- és
  pótkocsi-irány. KRESZ a `transport.ts`-ben: `heldUp` (követés, jobbkéz), `junctionWait`
  (kereszteződés-foglalás), `startBlocked` (kihajtás), `breakDeadlocks` (csak valódi körnél).
  Terhelési teszt: hub + 10 járat, ütközés ≈ 0 (1–2 kamion/járat).
  Mozgás: `t.v` sebesség, ACCEL 2,4 / DECEL 4,5; `brakeCap` (kanyar: `bendLimit`, √(A_LAT·r),
  és megállási pont), `trafficCap` (elöl haladó kamion, kereszteződés: várakozásnál a
  vonalig fékez, szabadon JUNCTION_SPEED). Kereszteződési várakozásnál a vonalig fékez
  (`toJunctionLine`), nem helyben áll meg. Megállóból a parkoló helyéről indul (`startS`),
  a `startBlocked` a mögötte érkezőket is nézi.
- Forgalomirányítás (`traffic.ts`): `map.controls` (cellaindex → light | roundabout | yield |
  stop), olvasáskor validálva (`activeControl`). Lámpa/körforgalom kereszteződésre, tábla a
  kereszteződés előtti útcellára. Logika: `controlWait` a `junctionWait`-ben ('approach' =
  a vonalig gurul, NEM foglal); körforgalom a `buildLane`-ben (R 0,3, óramutatóval
  ellentétes). Lámpaciklus a `TransportSim.clock`-ból. Eszközök: `TRAFFIC_TOOLS`.
- Kamera (`CameraRig.tsx`): a görgő az egér felé zoomol (`zoomToCursor`); WASD lágyan gyorsul (és tartva tovább gyorsul), elengedve
  kisiklik, a zoomtól függ; érzékenység `cameraSettings.ts` (Dev fül csúszka, localStorage),
  a forgatás/zoom sebességét is szorozza.
- Gyorsbillentyűk (`GameUI.tsx` KEYS / PANEL_KEYS): V/Esc, R/F/B, 1–8 eszközök, Szóköz, T,
  J/P/0 panelek, H súgó; WASD a kamera (CameraRig). Az egy példányos listener ref-en át
  hívja a friss kezelőt (különben az Esc-re újrarajzolás közben elveszik a billentyű).
- Modell-segéd: `lowPoly.ts` (`box`/`cyl`/rock részek → `buildParts` anyagonként összevont
  geometria; '#rrggbb' = csúcsszínes 'fixed', név = saját anyag). Erre épül a kamion, a vonat
  és a raktár.
- Vonat modell (`TrainModel.tsx`): `Locomotive` (LOCO_LEN 1,45) + `Wagon` (hopper / tank / box /
  flat; CAR_LEN 1,15; a hosszak a `sim/rail.ts`-ben), origó a kocsi közepén sínkorona-magasságban.
- Vonatok működése: útkeresés `rail.ts` (gráf: élek végpontjai = csomópontok; csomóponton csak
  ~egyenesen (cos > 0,9) mehet tovább, NEM fordul vissza → végállomáson hurok kell; `railRoute`
  Dijkstra irányított éleken; megálló = peronszakasz (`platforms`, `stopTargets`: eleje a túlsó
  végnél); `RailPath` = Lane + szegmensek (`pathAt` → él + hossz, a renderer magasságához)).
  Szimuláció a `transport.ts`-ben (`Train`, `tickTrains`): `TRAIN_PRICE` 8000, 3 kocsi × 30,
  seb. 4, gyorsulás 0,8, fék 1,6. Foglalás (`railHeld`): 'e'+él és 'c'+közös cella (váltó,
  keresztezés); indulás (`departTrain`) csak ha a teljes út a következő megállóig szabad
  (előbb a foglalt éleket kerülő útvonal = kitérő); különben `partialReserve`: előrébb megy egy
  csomópont + váltótorok elé, ha a foglaló vonat (`canGetOn`) így is tovább tud menni. `limit` =
  meddig mehet. Elengedés a szerelvény vége után (`freeBehind`). Átépítéskor `refindTrain`.
  Sorompó: `crossingClosed` (vonat eleje ≤ 8 cella), kamion `crossingAhead`, vonat
  `crossingCapTrain`. „foglalt pálya”: `snap.stalled`. Render: `Trains.tsx` (forgóvázak a pályán).
  Tesztek: scratchpad `trains.ts` (szintetikus súlyzó-pálya hurkokkal; `pass` = kitérővel, 2 vonat),
  `realrail.ts` (a játék sínépítőjével épített hurok).
  A sín nyomtávja ehhez igazítva: `Rails.tsx` GAUGE 0,075 (fél nyomtáv), a peron a sínig ér.
- Raktár: modell `DepotModel.tsx` (6×6, ipari egység ×2; `DepotDynamic` = lámpák +
  raklapok, a StaticBatch-en KÍVÜL), logika `depot.ts` + `transport.ts`. Megálló
  `kind: 'depot'` + `rot` a `map.stations`-ben (anchor = telek sarka). Lokális sorok:
  0–1 vágány (railNet élek), 2–4 csarnok + állások (Station cellák), 5 behajtó (Road).
  Egyirányú behajtó: be lx 0 (`depotEntrance`), ki lx 5 (`depotExit`); a `roadRoute`
  `oneWay` módban nem lép visszafelé rajta. Kamion: `state 'depot'`, `DepotVisit`
  fázisok wait → in → back → load → out; betolatás = a `bayPath` sávon visszafelé
  (sP → sDock). Udvar: `yard` (manőverezők: in/out + állás); egyszerre kettő is, ha az
  állásaik ≥ BAY_APART (3) távolságra vannak és a behajtó a bejárathoz közelebbi állásra
  megy (`yardFits`). A stopvonalnál (`gateHold`, kereszteződés ELŐTT) állást foglal:
  `pickBay` = a legtávolabbi illeszkedő szabad állás. `zones`: átmenő forgalom kerüli a
  betolatási zónát. Átrakás / forrás: `serveStop`, `ProductionSim.store/originOf`.
  Tesztek: scratchpad `depot.ts` (hub-szimuláció; a teszt utakat a behajtó zárásával
  építi, különben azon vezetne át).
- `StaticBatch` megtartja a csúcsszínt (vertexColors anyagnál) — e nélkül a
  lowPoly-modellek feketék.
- Víz emelése: az első emelés a part szintjére (0) tölti fel szárazföldnek
  (`terraformBatch`, `filled`), csak a következő emel egy lépcsőt (HILL_STEP 0,45).
- Olajfúró torony: térképenként pontosan 1, egy tó közepén (`placeOilRig`).
- Teljesítmény:
  - `StaticBatch.tsx` hierarchikusan összevonja a modellek hálóit (~5000 → ~920 rajzolási hívás).
    A szerkesztő alatt kikapcsol.
  - A modellekben nincs pontfény; a füst instancolt háló.
  - Az árnyék be van sütve (`ShadowController`), ezért változás után
    `gl.shadowMap.needsUpdate = true` kell.
  - Grafikai fokozatok (`render/quality.tsx`): Energiatakarékos / Kiegyensúlyozott /
    Maximum (FPS-korlát, pixelarány, árnyéktérkép). A Dev fül tetején választható,
    localStorage-ban tárolódik.

## Tesztelés a felhős gépen
- `npx tsc --noEmit -p tsconfig.app.json` és `npm run build` (a `-p .` NEM ellenőriz semmit: a gyökér tsconfig csak hivatkozás)
- Dev szerver: `npx vite --port 5173` a háttérben. Leállítás: `pkill -f "[v]ite --port 5173"`
  (a szögletes zárójel kell, különben a saját shellt is kilövi).
- Headless böngésző: Playwright (`require('playwright')`), indítás ezzel:
  `--use-gl=angle --use-angle=swiftshader --ignore-gpu-blocklist`
  - Képernyőképeket a scratchpadba ments, és nézd meg őket.
  - Tesztjárathoz ideiglenesen `window.__tb`-be tehető a terrain/transport store egy
    `App.tsx`-be rakott hookkal (utána `git checkout src/App.tsx`). Úthoz:
    `findTrackPath(map, a, b, CellType.Road)` + `terrain.buildPath(path)`.
  - Közeli képhez a kamerát egy ideiglenes `useThree`-s komponenssel lehet `window`-ra tenni
    a `GameCanvas`-ban (utána visszaállítani). Játékidő: `game.setSpeed(0|1|3)`.
  - A 2×-es `deviceScaleFactor` itt túl lassú (screenshot timeout); 1×-en tesztelj.
  - Valódi FPS itt nem mérhető (nincs GPU); a rajzolási hívások száma igen
    (Dev fül, `.dev__perf`).
- Modellnéző: `/?model=Mine` (Mine, LumberMill, PowerPlant, Factory, OilRig,
  StationModel, TruckStopModel, Truck, Train, Loco, Wagons, Depot).
- Szimulációs tesztek a scratchpadban: `run.sh` (depot.ts + traffic.ts esbuilddel; near = ütközés,
  stuck = beragadás), `speedtest.ts` (hirtelen fékezések száma).
- Ne `git checkout`-olj egész mappát a teszt után, mert a saját módosításaidat is visszaállítja.

## Állapot (2026-10-26)
- Mergelve: #65–#71 (dev fül és modellszerkesztő, modellnéző, olajfúró, állomások,
  belső nézet + termelés, kijelölő eszköz, kamionmegálló + járatok).
- Mergelve: #72 (teljesítmény + grafikai fokozatok + CLAUDE.md).
- Mergelve: #73 (belső nézet kikapcsolva, fix termelés).
- Mergelve: #74 (járatnézet, vízemelés, csuklós kamion + KRESZ, vékony utak).
- Mergelve: #75 (forgalomirányítás + új UI és gyorsbillentyűk).
- Mergelve: #76 (vonat- és raktármodellek, keskenyebb sín, a raktár mint játékelem).
- Mergelve: #77 (párhuzamos raktári beállás, fokozatos fékezés, kamera-érzékenység).
- Folyamatban: vonatjáratok (hurokkal fordulnak; a felhasználó a valósághűt kérte),
  zoom az egér felé.
  **Prioritás: a szállítás legyen jó.**
- A felhasználó nehézségi szintet („mester”) említett, de választó NEM kell, csak az eszközök.

## Következő lépések
- Vasúti jelzők (szakaszolás, több vonat egy vonalon), sorompó animáció, vonathossz választás
- Huroképítés segítése (a sínépítő mutassa, merre néz a váltó)
- A város mint fogyasztó (keresletet támaszt az árukra)
- Később (`ötletek.md`): a bányát a játékos építi fel (lyukból indul), modellenként
  saját belső tér, többsávos szalagok, hidak, járművek fejlődése az évek során
