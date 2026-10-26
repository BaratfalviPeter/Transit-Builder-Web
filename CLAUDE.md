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
- Forgalomirányítás (`traffic.ts`): `map.controls` (cellaindex → light | roundabout | yield |
  stop), olvasáskor validálva (`activeControl`). Lámpa/körforgalom kereszteződésre, tábla a
  kereszteződés előtti útcellára. Logika: `controlWait` a `junctionWait`-ben ('approach' =
  a vonalig gurul, NEM foglal); körforgalom a `buildLane`-ben (R 0,3, óramutatóval
  ellentétes). Lámpaciklus a `TransportSim.clock`-ból. Eszközök: `TRAFFIC_TOOLS`.
- Gyorsbillentyűk (`GameUI.tsx` KEYS / PANEL_KEYS): V/Esc, R/F/B, 1–8 eszközök, Szóköz, T,
  J/P/0 panelek, H súgó; WASD a kamera (CameraRig). Az egy példányos listener ref-en át
  hívja a friss kezelőt (különben az Esc-re újrarajzolás közben elveszik a billentyű).
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
  StationModel, TruckStopModel, Truck).
- Ne `git checkout`-olj egész mappát a teszt után, mert a saját módosításaidat is visszaállítja.

## Állapot (2026-10-26)
- Mergelve: #65–#71 (dev fül és modellszerkesztő, modellnéző, olajfúró, állomások,
  belső nézet + termelés, kijelölő eszköz, kamionmegálló + járatok).
- Mergelve: #72 (teljesítmény + grafikai fokozatok + CLAUDE.md).
- Mergelve: #73 (belső nézet kikapcsolva, fix termelés).
- Mergelve: #74 (járatnézet, vízemelés, csuklós kamion + KRESZ, vékony utak).
- Nyitva: #75 (forgalomirányítás: táblák, lámpa, körforgalom + új UI és gyorsbillentyűk).
  **Prioritás: a szállítás legyen jó.**
- A felhasználó nehézségi szintet („mester”) említett, de választó NEM kell, csak az eszközök.

## Következő lépések (felajánlva, a felhasználó még nem választott)
- Vonatok a hálózati nézetben, vasútállomások között
- A város mint fogyasztó (keresletet támaszt az árukra)
- Később (`ötletek.md`): a bányát a játékos építi fel (lyukból indul), modellenként
  saját belső tér, többsávos szalagok, hidak, járművek fejlődése az évek során
