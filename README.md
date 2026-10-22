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
            #   Rails          – sínek (kavicságy + talpfák + sínszálak)
            #   CityBuildings  – a város auto-épületei (szint = magasság)
            #   GridFloor      – vizuális referencia-rács (nem pick-sík)
            #   usePointerBuild.ts – megosztott click+drag kezelők (stopPropagation)
            #   CameraRig      – RTS kamera (drei MapControls)
            #   GameClock      – useFrame-alapú játékidő (a GameCanvas-ban)
            #   terrainStyle.ts / config.ts
  ui/       # React overlay
            #   Hud       – épület/út számlálók + vezérlés-hint
            #   SidePanel – oldalsó fülek (Földmunka / Infrastruktúra / Pénzügyek)
            #               + dátum és időkontroll (⏸ ▶ ⏩)
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

A jobb oldali **panel** három füle:

- **Földmunka (Terraforming):** **Emelés** ($50) hegyet épít, **Süllyesztés**
  ($50) árkot ás, **Bontás** (bulldózer, ingyen) utat/sínt/fát töröl. Az
  emelés/süllyesztés **kijelölős**: a kattintással/húzással kijelölt cellák
  **piros** rácsot kapnak, majd az **Építés** gombra fizetsz és a cellák
  **sárga** „under construction" jelet kapnak, végül egy rövid (valós idejű,
  **nem** in-game) késleltetés után **egyszerre** megépülnek. (A batch-elés
  miatt bármennyi cella is **egyetlen** gyors geometria-frissítés.)
- **Infrastruktúra (Transport):** **Út** ($10) és **Sín** ($20). Mindkettő üres
  (fű) cellára vagy domb tetejére/oldalára építhető (felveszi a lejtő dőlését és
  magasságát), és **húzva** is lerakható. A sarok/csúcs lejtőkre nem lehet.
  A sín **rácshoz kötött**: az egyenesek 8 irányban (tengely mentén vagy
  átlósan) cellaközéptől cellaközépig futnak, a kanyarok pedig 45°-os
  ív-darabok (sugár ≈ 2,4 / 4,8 / 7,2 cella), amelyek szintén cellaközépen
  végződnek. A 90°-os kanyar két ilyen darab, így S-kanyar is építhető.
  Leágazni / becsatlakozni egy meglévő sín **egyenes** szakaszának
  cellaközepén lehet (váltó), egy holtvég pedig egyenesen folytatható.
- **Pénzügyek (Economy):** egyenleg, összes bevétel és kiadás.
- **Dev:** fejlesztői eszközök.
  - **Látvány beállítás:** a fény- és színcsúszkák panelje.
  - **Modellszerkesztő** (csak `npm run dev` alatt): kattints egy ipari épület
    egy elemére, és a fogantyúval (vagy a −/+ gombokkal) mozgasd, forgasd,
    méretezd. Elengedéskor a változás **közvetlenül a modell `.tsx`
    fájljába** íródik (pl. `p={[0.4, 0.2, -1]}` → `p={[0.45, 0.2, -1]}`), és
    a modell azonnal újratöltődik. ▲ Szülő / ▼ Gyerek: a kijelölés a
    befoglaló / belső elemre lép. Gyorsbillentyűk: 1/2/3 mód, PageUp/PageDown
    szülő/gyerek, Esc kijelölés törlése, Ctrl+Z az utolsó mentés visszavonása.
    Működése: `dev/modelEditorPlugin.ts` (Babel-címkézés + író végpont) és
    `src/dev/` (kijelölés, fogantyú).

A panel tetején a **dátum** (1970. 01. 01-ről indul) és az időkontroll:
⏸ szünet · ▶ normál · ⏩ gyorsított. Normál tempónál 1 valós másodperc ≈ 1 nap.

> Az ipar (fatelep, bánya, erőmű, gyár) **magától generálódik** a nyersanyaga
> közelében, szétszórva — a játékosnak kell összekötnie úttal/sínnel.

### Terraformálás és víz-fizika

A **Süllyesztés** a talajszint (Y=0) alá ásott cellát **Water**-ré változtatja
(medence). Ha egy cellát pont a talajszintre süllyesztenek vissza és **meglévő
vízhez szomszédos**, a víz elönti azt is. A megerősített kijelölés **egyetlen
batch**-ben, egy commit-tal frissíti az egységes terep-mesh magasságait — így
akárhány cella is gyors; a mesh fix méretű bufferben, helyben patch-elődik.

Vezérlés:
- **Bal gomb**: építés / tereprendezés / törlés (kattintás vagy húzás)
- **Mozgás (pan)**: WASD vagy nyílbillentyűk · **Jobb húzás**: forgatás ·
  **Görgő / középső gomb**: zoom

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
