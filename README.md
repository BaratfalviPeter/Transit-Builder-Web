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
            #   GameUI    – felső sáv (pénz, dátum, ⏸ ▶ ⏩, számlálók),
            #               panelgombok (Járatok / Pénzügyek / Dev / Súgó),
            #               alsó eszköztár (Terep / Építés / Forgalom),
            #               gyorsbillentyűk
  App.tsx
  main.tsx
public/
  models/   # ide kerülnek a .obj/.glb modellek (lásd models/README.md)
```

### Teljesítmény

- **Statikus összevonás** (`src/render/StaticBatch.tsx`): az ipari modellek és
  a megállók sok száz kis hálóból állnak. Betöltés után kb. 1,2 mp-ig figyeli
  őket, majd anyagonként összevonja a hálókat — hierarchikusan: minden háló a
  legfelső olyan ősébe kerül, amihez képest nem mozdul (a statikus részek a
  modell gyökerébe, egy daru darabjai a daru mozgó csoportjába). Az eredetiek
  egy nem renderelt rétegre kerülnek, és félmásodpercenként ellenőrzi őket:
  ami mégis megmozdul / eltűnik, azt visszaveszi. A modellszerkesztő alatt
  ki van kapcsolva. Eredmény egy átlagos térképen: **~5000 → ~920** rajzolási
  hívás képkockánként.
- **Nincs pontfény a modellekben:** a izzó részek emisszív anyaggal
  világítanak (minden fény a teljes jelenet minden pixelén fizetendő).
- **Füst:** egy füstoszlop egyetlen instancolt háló.
- **Dev fül:** FPS / rajzolási hívás / háromszög kijelzés (`src/dev/perf.tsx`).

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

- **Felület:** fent balra pénz, dátum, sebesség (⏸ ▶ ⏩) és számlálók; fent
  jobbra a panelek (Járatok, Pénzügyek, Dev) és a Súgó; lent az eszköztár
  csoportokban (Terep / Építés / Forgalom), mindegyik gombon az ár és a
  gyorsbillentyű, fölötte egy sorban az aktív eszköz rövid leírása.
- **Gyorsbillentyűk** (H: súgó):

  | Billentyű | Mit csinál |
  |---|---|
  | V / Esc | Kijelölés (Esc: mégse) |
  | R / F / B | Emelés / Süllyesztés / Bontás |
  | 1–4 | Út / Sín / Vasútállomás / Kamionrakodó |
  | 5–8 | Elsőbbségadás / STOP / Lámpa / Körforgalom |
  | Szóköz / T | Szünet / gyorsítás |
  | J / P / 0 | Járatok / Pénzügyek / Dev panel |
  | WASD, nyilak | Kamera mozgatása |
- **Földmunka (Terraforming):** **Emelés** ($50) hegyet épít, **Süllyesztés**
  ($50) árkot ás, **Bontás** (bulldózer, ingyen) utat/sínt/fát töröl. Az
  emelés/süllyesztés **kijelölős**: a kattintással/húzással kijelölt cellák
  **piros** rácsot kapnak, majd az **Építés** gombra fizetsz és a cellák
  **sárga** „under construction" jelet kapnak, végül egy rövid (valós idejű,
  **nem** in-game) késleltetés után **egyszerre** megépülnek. (A batch-elés
  miatt bármennyi cella is **egyetlen** gyors geometria-frissítés.)
- **Infrastruktúra (Transport):** **Út** ($10), **Sín** ($20), **Vasútállomás** ($500) és **Kamionrakodó** ($300). Mindkettő üres
  (fű) cellára vagy domb tetejére/oldalára építhető (felveszi a lejtő dőlését és
  magasságát), és **húzva** is lerakható. A sarok/csúcs lejtőkre nem lehet.
  A sín **rácshoz kötött**: az egyenesek 8 irányban (tengely mentén vagy
  átlósan) cellaközéptől cellaközépig futnak, a kanyarok pedig 45°-os
  ív-darabok (sugár ≈ 2,4 / 4,8 / 7,2 cella), amelyek szintén cellaközépen
  végződnek. A 90°-os kanyar két ilyen darab, így S-kanyar is építhető.
  Leágazni / becsatlakozni egy meglévő sín **egyenes** szakaszának
  cellaközepén lehet (váltó), egy holtvég pedig egyenesen folytatható.
  - **Vasútállomás** ($500): az ipar telkének egyik oldalára illeszthető
    csatlakozási pont (az ipar és a szállítás közti kapu). Vidd az egeret egy
    ipar oldala fölé (vagy magára az épületre — a legközelebbi oldalt
    választja): zöld/piros előnézet mutatja a helyét, a címke az árat vagy
    azt, miért nem építhető. Az állomás 6 cella hosszú: a telek mellett peron
    rakodóhangárral, mögötte egy átmenő, egyenes vágány, amelyre a sínépítő
    mindkét végén rácsatlakozhat. Oldalanként legfeljebb egy; szabad, sík,
    a telekkel egy szintű terep kell; az olajfúróhoz nem építhető. Bontáskor
    az egész állomás (vágánnyal együtt) eltűnik. (`src/sim/stations.ts`,
    `StationModel.tsx`, `Stations.tsx`)
  - **Kamionrakodó** ($300): ugyanígy az ipar oldalára illeszthető megálló,
    de a külső sora **út** (a meglévő úthálóhoz csatlakozik). Bent ugyanúgy
    kapu („🚚 Rakodó”). Oldalanként egy megálló (vasútállomás vagy rakodó).
- **Járatok:** a fül megnyitásakor a térkép **járatnézetbe** vált: felülnézet,
  elszürkített térkép, kiemelt megállók. **Új kamionjárat** ($1500, egy
  kamionnal): kattints a rakodókra sorban, a járat színes vonalként követi az
  utat (fehér szaggatott előnézet), **Kész**. A járat a végén visszafordul az
  elsőhöz. Ahol több járat ugyanazon az úton megy, a vonalak egymás mellett
  futnak (metrótérkép). A listában: kamionok száma (+ / −, eladáskor ½ ár
  vissza), törlés, „nincs út!” figyelmeztetés.
  - **Kamionok:** a járat megállóit körbejárják (jobb oldali közlekedés).
    Megállónként előbb **leadják**, amit az ottani ipar átvesz (gyár: deszka;
    erőmű: érc, zúzott érc, olaj), és ez **fizet**: egység × ár × (1 + távolság / 25); a megálló
    fölött „+$” jelzi. Aztán **felrakják** (max. 20), amit egy későbbi
    megálló átvesz. (`src/sim/transport.ts`, `src/render/Transport.tsx`,
    `src/ui/LinesPanel.tsx`)
  - **Modell:** csuklós nyerges kamion (platós vontató + ponyvás pótkocsi,
    `src/render/TruckModel.tsx`); a fülke és a ponyva színe kamiononként más,
    a pótkocsi oldalán a járat színe csíkként. A kanyarban a pótkocsi behajlik.
    Új kamion a „garázsból” indul (amíg el nem indul, nem látszik).
  - **KRESZ:** a jobb sávban, lekerekített kanyarokkal (jobbra szűken, balra
    tágan) mennek; követési távolság; kereszteződésbe (3+ irányú útcella) csak
    akkor hajtanak be, ha szabad, és mögötte elfér az egész kamion (a
    kereszteződést lefoglalják, amíg a pótkocsi ki nem ér); a megállóból
    kihajtó elsőbbséget ad; egyébként jobbkéz-szabály. Valódi körbe-várakozás
    (holtpont) esetén a körből egy kamion rövid ideig áthaladhat.
  - **Mozgás:** fokozatosan gyorsulnak és fékeznek; kanyar előtt lassítanak
    (szűk kanyarban jobban), az elöl haladó és a kereszteződés előtt
    időben fékeznek, várakozáskor a vonalig gurulnak.
- **Vonatok** (`src/sim/rail.ts`, `transport.ts`, `src/render/Trains.tsx`):
  vonatjárat vasútállomások és raktárak között (Járatok → „Új vonatjárat”;
  mozdony $5000 + kocsinként $1000, kocsinként 30 egység, 4 cella/s).
  - **Vonathossz** járatonként 1–6 kocsi (alap 3; a „🚃 − +” sorral). Hosszabbításkor
    vonatonként fizetsz egy kocsit; a vonatok a következő megállójukban veszik fel
    / adják le. A peronnál hosszabb vonat hátul kilóg.
  - A vonat a kamionhoz képest arányosan nagy (×1,25), a sín nyomtávja is.
  - A vonat **csak előre** megy, a váltókon a sín irányában (nem fordul
    vissza): a végállomásoknál **fordítóhurok** kell (vagy az egész pálya kör).
    Ha nincs, a járatnál „nincs út!” jelenik meg.
  - A vonat a peronon áll meg úgy, hogy az egész szerelvény a peronon legyen;
    a kocsik típusa a rakománytól függ (érc → garatos, olaj → tartály stb.).
  - **Biztonság:** indulás előtt lefoglalja az utat a következő megállóig
    (vágányszakaszok, váltók, keresztezések), és csak akkor indul, ha az
    szabad; a vonat mögött felszabadul. Ha a cél peron foglalt, előrébb
    megy, és egy olyan helyen vár (pl. **kitérőben**), ahol nem áll a másik
    útjába. Szabad párhuzamos vágányt (kitérőt) magától választ.
    Egyvágányú pályán kitérő nélkül csak egy vonat járhat; ha a vonatok
    egymásra várnak, a járatnál „foglalt pálya” jelzés jelenik meg.
  - **Vasúti jelzők** (G, $400, `src/sim/signals.ts`, `src/render/Signals.tsx`):
    a sínre kattintva a kurzor felőli oldalra kerül, és az ott (jobb kéz
    felől) haladó vonatoknak szól; újra kattintva megfordul, Bontással
    leszedhető. Váltótól / keresztezéstől 1–2 cellára kell lennie.
    A jelzők blokkokra osztják a pályát: a vonat csak a következő
    felé néző jelzőig foglal, és ott vár, ha a következő blokk foglalt
    (piros); ha felszabadul, vagy talál szabad párhuzamos vágányt, továbbmegy
    (zöld). Így egy vonalon több vonat is járhat (pl. kitérővel,
    a kitérő két végén egy-egy jelzővel).
  - **Szintbeli kereszteződés:** a kamionok megállnak, ha vonat közeledik
    (8 cellán belül) vagy a sínen van; a vonat fékez, ha kamion van rajta.
    Félsorompó mindkét irányból (`src/render/LevelCrossings.tsx`):
    András-kereszt, két felváltva villogó piros lámpa, piros-fehér kar;
    közeledő vonatnál előbb villog, majd leereszkedik, utána felemelkedik.
  - Ha menet közben átépíted a vágányt (pl. váltót teszel bele), a vonat az
    új hálózaton megy tovább.
- **Raktár** ($6000, 9-es gomb, `src/sim/depot.ts`, `src/render/DepotModel.tsx`):
  6×6-os átrakóhely sík, üres területre (**Q**: forgatás). Két vágány
  (vonatoknak, később), csarnok, 5 rakodóállás és egy **egyirányú behajtó**
  (útcellák): a nyugati végén be, a keleti végén ki — **mindkét véghez kell
  út** (különben „nincs út!”).
  - A raktár megálló: a járatokba ugyanúgy felvehető, mint a rakodók.
  - **Kamionok a raktárnál:** a behajtó előtt (kereszteződés előtt) várnak,
    amíg nincs szabad állás vagy más manőverezik (piros lámpa); aztán
    elhaladnak a szabad állás mellett, **betolatnak**, ki- és berakodnak,
    majd a kijáraton távoznak. Két kamion is manőverezhet egyszerre, ha az
    állásaik elég messze vannak (pl. az első és az utolsó): az érkező a
    legtávolabbi szabad állásra megy, hogy a következő a közelebbire állhasson.
    A kapuk fölötti lámpák mutatják a foglalt / szabad állásokat.
  - **Átrakás és válogatás:** a raktárban azt rakják le, amit a járatuk
    egyik ipari megállója sem vesz át; és azt veszik fel, amit valamelyik
    átvesz. Ipari megállóban, ha a járat későbbi megállója raktár, bármit
    felvesznek. Kapacitás: 400 egység.
  - **Fizetés:** az áru megjegyzi, honnan indult (a raktár súlyozott
    átlagot tárol), és a végső leadáskor a teljes útért fizet.
- **Forgalomirányítás** (az alsó eszköztár „Forgalom” csoportja, `src/sim/traffic.ts`,
  `src/render/TrafficControls.tsx`):
  - **Elsőbbségadás tábla** ($60) és **STOP tábla** ($60): közvetlenül egy
    kereszteződés előtti útcellára. A táblás irányból érkező kamion a
    vonalnál elengedi a tábla nélküli irányokból érkezőket; STOP-nál előbb
    mindig megáll (1 mp).
  - **Lámpa** ($800): kereszteződésre (3–4 irányú útcella). Minden ágon
    lámpaoszlop; a két tengely felváltva kap zöldet (6 mp zöld, 2 mp sárga /
    piros). Piroson és sárgán a kamionok a vonalnál várnak.
  - **Körforgalom** ($1200): kereszteződésre (mellette nem lehet másik
    kereszteződés). Füves sziget; a kamionok az óramutatóval ellentétesen
    kerülik meg.
  - Bontás eszközzel előbb a tábla / lámpa / körforgalom tűnik el (az út marad).
- **Pénzügyek (Economy):** egyenleg, összes bevétel és kiadás.

### Termelés (fix)

Az iparágak egyelőre **fix ütemben** termelnek (játékmásodpercenként), ha van
legalább egy megállójuk:

| Ipar | Mit csinál | Ütem |
|---|---|---|
| Bánya | ércet termel | 0,5 / s |
| Fatelep | deszkát termel | 0,5 / s |
| Olajfúró | olajat termel | 0,4 / s |
| Gyár | a leadott deszkából árut gyárt | max. 1 / s |
| Erőmű | elégeti a leadott ércet / olajat | max. 2 / s |

- A termék az ipar **legüresebb megállójába** kerül (megállónként max. 100).
  Innen viszik el a kamionok. A gyár áruját is el lehet szállítani.
- A termelés a játékidővel fut (szünetben áll, gyorsítva 3×).
- `FIXED_PRODUCTION` a `src/sim/production.ts`-ben.

**Belső (mikro) nézet: egyelőre kikapcsolva.** A kódja megvan (gépek,
futószalagok, kapuk: `src/sim/interior.ts`, `InteriorStore.ts`,
`production.ts`, `src/interior/`). A `src/sim/interior.ts`-ben az
`INTERIORS_ENABLED = true` kapcsolja vissza: ekkor a kijelölő eszközzel egy
iparra kattintva megnyílik a belseje, és a termelést a gépek adják.

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
  - **Modellnéző** (`?model=MineModel`, a Dev fülről új lapon nyílik): egyetlen
    modell közelről, a 3×3-as telek rácsán, a Látvány-beállítások fényeivel.
    Modellválasztó, fix nézetek (Átlós / Elöl / Oldalt / Hátul / Felül, egérrel
    szabadon forgatható), és itt is működik a modellszerkesztő. URL-paraméterek:
    `model=MineModel|LumberMillModel|PowerPlantModel|FactoryModel|OilRigModel|StationModel`,
    `view=iso|front|side|back|top`, `ui=0` (panel nélkül, tiszta képekhez).

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
- **Zoom**: görgő — az egérmutató alatti pont felé
- **Mozgás (pan)**: WASD vagy nyílbillentyűk (lágyan gyorsul, tartva egyre
  gyorsabb; az érzékenység a Dev fül „Kamera” csúszkájával állítható) · **Jobb húzás**: forgatás ·
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
utakkal kell összekötnie őket.

Minden térképen pontosan **egy olajfúró torony** (OilRig 🛢️) is generálódik,
egy nagyobb tó **közepén**: a 6×6-os telek körül minden irányban legalább 4
cella nyílt víz van, sosem a parton áll. Ha a térképen nincs ekkora víz, a
generátor egy sík, alacsony területen kiváj egy nagyobb tavat
(`RIG_MARGIN`, `RIG_LAKE_RADIUS` a `terrain.ts`-ben). A telek vízként
rajzolódik, a modell (`OilRigModel.tsx`) a vízfelszínen áll. A speciális épületek fölött **lebegő UI ikon** jelenik meg
(drei `<Html>`), finom bobbing animációval, a könnyű azonosításhoz.
