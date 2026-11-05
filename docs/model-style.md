# Low poly modell stílusszabályok (Transit Builder)

Ezt a fájlt minden modellt építő és ellenőrző ágens elolvassa. Ha a stílus változik, itt kell átírni.
A számok a meglévő modellekből vannak mérve (2026-11).

## Alapok
- A modell egy React komponens: `src/render/<Név>Model.tsx` (pl. `src/render/LumberMillModel.tsx`).
  A fájlnév `…Model.tsx` legyen, a `src/render/` mappában: a dev modellszerkesztő
  (`dev/modelEditorPlugin.ts`, `EDITABLE_FILES`) csak ezeket tudja szerkeszteni.
- Props (mint a többi iparágnál): `{ position?: V3; scale?: number; rotationY?: number; phase?: number }`,
  a gyökér `<group position={position} scale={scale} rotation={[0, rotationY, 0]}>`. A `phase` az
  animációk eltolása (több egyforma épület ne mozogjon egyszerre).
- Geometria: a közös egységkocka (`BOX` + `<Box p s m cast />`) és a `<Pipe>`, `<Elbow>`, `<Steam>`
  a `src/render/PowerPlantModel.tsx`-ből; ezen kívül `cylinderGeometry` (6–12 szegmens),
  `coneGeometry`, ritkán `sphereGeometry` / `icosahedronGeometry` (szikla) alacsony
  szegmensszámmal. Sok egyforma elem (rönkök, deszkák) → `InstancedMesh`.
  Járműveknél / egyszerűbb épületnél a `src/render/lowPoly.ts` (`box` / `cyl` / `ball` / `profile`
  részek → `buildParts` összevonja; `'#rrggbb'` = csúcsszínes `FIXED_MAT`).
- Anyagok: a fájl elején EGY közös `M` objektumban, modul-szinten (nem JSX-ben, nem renderenként):
  `const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra })`,
  utána `Object.values(M).forEach((m) => patchCloudShadows(m))` (`./cloudShadows`), hogy a
  felhőárnyék rájuk is essen. Textúra nincs.
- Árnyalás: alapból sima (`MeshStandardMaterial`), `flatShading: true` csak szikláknál, silóknál,
  sokszögű tömböknél. Fémes részek: `metalness` 0,2–0,5, `roughness` 0,5–0,7.
- Pontfény NINCS a modellben. Ami világít (ablak, kemence, láng), az
  `new THREE.MeshBasicMaterial({ color, toneMapped: false })` (nem `emissive`).
- Elemszám (mérve, modellnézőben): bánya ~600, fatelep ~320, gyár ~330, erőmű ~140, olajfúró ~670
  mesh; 4,5–11,5 ezer háromszög. Cél egy új iparágnál: **150–400 mesh, ≤ 8000 háromszög**. A játékban
  a `StaticBatch` (`src/render/StaticBatch.tsx`) a mozdulatlan részeket anyagonként összevonja, így
  a sok apró elem nem drága — a háromszögszám és a sok különböző anyag viszont igen.

## Méret és elhelyezés
- TERVEZÉSI EGYSÉG = 1 cella (`src/render/config.ts`: `cellSize` 1). Az iparági modell egy
  **3×3-as telekre** készül (x, z ∈ [−1,5; 1,5]); a játék `cellSize × INDUSTRY_MODEL_SCALE`-lel
  (`src/sim/terrain.ts`, = 6 / 3 = **2**) nagyítja a 6×6 cellás telekre.
  A járművek NEM skálázódnak: a modell egységében egy kamion / vonat a fele akkora, mint a játékban
  (vonat: mozdony 1,45 × `TRAIN_SCALE` 1,25 ≈ 1,8 cella hosszú → a modellben ≈ 0,9).
- Alap: betonlap `<Box p={[0, 0.05, 0]} s={[3, 0.1, 3]} />` (teteje y = 0,1), fugákkal
  0,5-enként, körben világos szegély (±1,47-nél, ~0,06 magas). A lap fölé épít minden más.
- Origó: a telek közepe, talajszinten (y = 0). A talaj alá csak akkor nyúlhat, ha a játék kivágja
  a telket (mint a bánya gödre; a modellnéző ezt magától lyukként mutatja). Az olajfúrónál y = 0 a
  vízfelszín.
- A telekről csak a magas részek lóghatnak ki kicsit (daru gémje, siló teteje), a talajon semmi.
- Y felfelé mutat. **−Z = hátul, +Z = elöl (bejárat / rakodó oldal), +X = jobb.** A fájl elején a
  komment így írja le az elrendezést (lásd `LumberMillModel.tsx`). A játék a modellt véletlenszerűen
  0 / 90 / 180 / 270°-kal elforgatja (`src/render/Industries.tsx`), ezért minden oldal látszik.
- Megálló-modelleknél (állomás, kamionrakodó) más a rendszer: +Z az ipartól EL mutat, a peronsor
  z ∈ [−0,5; 0] (`StationModel.tsx`).

## Paletta
A meglévő iparágak közös színei (a pontos értékek az `M` objektumokban). Ugyanarra a szerepre ezt
használd, ne újat:
- Betonlap / fedélzet: `#d8d2c6`, szegély `#ece6da`, fuga `#bfb7a8`; burkolat (fatelep) `#e2d6b8`
- Aszfalt: `#66635f` – `#7a736b`
- Csarnokfal (palakék acél): `#3f4655`, sötétebb `#2f3540`; erőmű `#4a5262`
- Tető: `#5a5c61` (acél), `#5a5350` (fatelep); tetőborda `#6b5244`
- Tégla: `#8f4a36` / `#9a4632`, sötét `#74311f`
- Fa / deszka: `#7a4a2e`, sötét `#5e3721`; láda `#a8794a` / `#7d5634`; raklap `#b48a5a`; rönk kéreg
  `#6a4428`, vágott vég `#d9a86c`
- Fém / gép: acél `#7d828b`, keret `#2f333a`, sötét `#2a2c31`, cső szürke `#8f959c` – `#9aa0a7`,
  tartály `#9a9ea4`, szalag `#26282c`, kábel `#1d1f23`, gumi `#1f2125`
- Rozsda (csövek, sávok): `#8f4a2f`, sötét `#6a3420`
- Kék kiegészítő (cső, hordó, láda): `#5a7f9e` / `#4f7fae`, hordó `#3f5a78`
- Kiemelő sárga (daru, korlát, veszély): `#e8b82e`; szelep piros `#c23a2b`; ajtó `#8a3f26`
- Üveg (nappal): `#3d4a55`
- Világító (MeshBasicMaterial): ablak `#ffd36b`, izzás `#ffb347`, kemence `#ff8a2a`
- Szikla / föld: `#6e655b`, `#5c5650`, `#7d7266`; föld `#8a6a4a`; fű `#7f8a48`
- Egy modell kb. 30–40 anyagot használ, de ezek nagy része a fenti közös színek; ÚJ szín
  modellenként legfeljebb 5–6 legyen (a saját jellegzetes elemeihez).

## Mozgó részek
- Ami mozog (daru, kerék, szalag, füst, kocsik), az külön elnevezett `<group name="...">`-ban
  legyen, `useFrame`-mel animálva (a `phase`-t hozzáadva az időhöz).
- A statikus részeket NE tedd mozgó groupba: a `StaticBatch` a mozdulatlan részeket a modell
  gyökeréhez, a mozgókat a saját groupjukhoz vonja össze.
- Füst: a közös `<Steam>` (instancolt).

## Arányok és hangulat
- Kicsit játékszerű, tömzsi arányok: vastag falak, nagy tetők, felülnézetből is jól olvasható
  sziluett (a játékban főleg felülről, átlósan látszik).
- Minden oldalnak legyen értelme: a hátoldal se legyen üres fal (szellőző, létra, hordók, raklapok).
- Részletek a földön is: raklap, hordó, láda, rönkhalom, kerítés / sárga korlát, kis sínpálya kocsival.

## Példák
A meglévő modellek közül ezeket kell mintának tekinteni:
- `src/render/LumberMillModel.tsx` — FŐ MINTA (a felhasználó jóváhagyta): tiszta felépítés (alrészek külön
  függvényekben: `Ground`, `Barn`, `Crane`, `Stacks`…), közös `M` anyagok, InstancedMesh a sok
  egyforma elemre, animált daru, ~320 mesh.
- Segédek: `src/render/PowerPlantModel.tsx` (`Box`, `Pipe`, `Elbow`, `Steam`), `src/render/lowPoly.ts`.
