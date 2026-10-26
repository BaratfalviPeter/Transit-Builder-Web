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
- `src/ui/`: DOM UI (SidePanel fülek: Földmunka, Infrastruktúra, Járatok, Pénzügyek, Dev)
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
- Belső nézet: 12×12 rács (`interior.ts`). Gépek receptekkel, szalag 1,5 mező/s,
  állomáskapacitás 100 (`production.ts`).
- Járatok (`transport.ts`): teherautó $1500, 20 egység, sebesség 3. Fizetés:
  egység × érték × (1 + táv/25). Hálózati nézet metrótérkép-stílusban
  (`Transport.tsx`, szürke fátyol, a vonalak egymás mellett futnak).
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
- `npx tsc --noEmit -p .` és `npm run build`
- Dev szerver: `npx vite --port 5173` a háttérben. Leállítás: `pkill -f "[v]ite --port 5173"`
  (a szögletes zárójel kell, különben a saját shellt is kilövi).
- Headless böngésző: Playwright (`require('playwright')`), indítás ezzel:
  `--use-gl=angle --use-angle=swiftshader --ignore-gpu-blocklist`
  - Képernyőképeket a scratchpadba ments, és nézd meg őket.
  - Valódi FPS itt nem mérhető (nincs GPU); a rajzolási hívások száma igen
    (Dev fül, `.dev__perf`).
- Modellnéző: `/?model=Mine` (Mine, LumberMill, PowerPlant, Factory, OilRig,
  StationModel, TruckStopModel).
- Ne `git checkout`-olj egész mappát a teszt után, mert a saját módosításaidat is visszaállítja.

## Állapot (2026-10-26)
- Mergelve: #65–#71 (dev fül és modellszerkesztő, modellnéző, olajfúró, állomások,
  belső nézet + termelés, kijelölő eszköz, kamionmegálló + járatok).
- **Nyitva: #72**: teljesítmény (StaticBatch, fények, füst, perf kijelző) és grafikai fokozatok.

## Következő lépések (felajánlva, a felhasználó még nem választott)
- Vonatok a hálózati nézetben, vasútállomások között
- A város mint fogyasztó (keresletet támaszt az árukra)
- Később (`ötletek.md`): a bányát a játékos építi fel (lyukból indul), modellenként
  saját belső tér, többsávos szalagok, hidak, járművek fejlődése az évek során
