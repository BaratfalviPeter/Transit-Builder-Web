# Ötletek

Későbbre félretett tervek és irányok. Ami megvalósul, azt innen áthúzzuk vagy
átvisszük a README-be.

## Makro és mikro nézet

A játék két szinten működik:

- **Makro nézet:** a térkép. Utak, sínek, vonatok, állomások, a logisztika.
- **Mikro nézet:** egy-egy ipar belseje, ahol a termelést rakja össze a
  játékos (gépek, futószalagok, feldolgozó egységek).
- **A kettőt a csatlakozási pontok kötik össze:** a telek oldalaira illesztett
  állomások. Ahol kint állomás van, ott bent a rács szélén kapu van; ami a
  kapun kimegy, az az állomás raktárába kerül, onnan viszi el a vonat.

Az elfogadott irány (a): a belső nézet **külön, közeli, rácsos nézet**
(Factorio-szerű), saját low-poly modellekkel.

## B terv: a kinti modellt is a játékos építi fel

A belső nézet később átalakulhat úgy, hogy **a kinti, makro modell sem kész
épület**, hanem a játékos építi fel bentről:

- **A bánya egy lyukkal kezdődik.** A gödröt, a teraszokat, a gépeket a
  játékos ássa és építi ki.
- **Amit bent megépítesz, az látszik kint is:** darukat, később nagyobb
  darukat, tárolókat, tartályokat, futószalagokat, csöveket.
- Így minden ipar egyedi lesz, és a fejlődése kívülről is látszik.
- Ehhez a mostani kész modelleket (`MineModel`, `LumberMillModel`, …) elemekre
  kell bontani (gödör, daru, siló, szalag, cső), amelyeket a belső építés
  helyez el és fejleszt.

## Belső nézet — későbbi finomítások

> **Jelenleg kikapcsolva** (`INTERIORS_ENABLED = false`): a játék fix termeléssel
> megy, amíg a szállítás el nem készül. Utána innen folytatjuk.

- **Minden iparnak saját, a modelljéhez illő belső tere:** ne egy általános
  rács legyen, hanem a bánya belseje a valódi gödör, a fatelepé a fűrésztelep
  udvara, az olajfúróé a fedélzet stb.
- **Többsávos futószalagok:** egy szalagon két (vagy több) sáv, külön árukkal.

## További irányok (a megbeszélt sorrend után)

- Teherautók az utakon, teherautó-rakodó a telkek oldalán.
- A város növekedése függjön az áruellátástól (áru, utasok).
- Hidak a folyók fölött.
- Új járműtípusok az évek múlásával (a játék 1970-ben indul).

## Feltételes ötlet: lerakható iparágak, fix lelőhelyekkel

> A felhasználó jónak tartja, de **még csak ötlet** — a város és a gazdasági
> nyomás után döntünk róla.

- A gyárakat, bányákat, erőműveket a **játékos rakja le** (ár + fenntartás),
  nem a térképgenerátor.
- Fixek csak a **lelőhelyek** maradnak: ércmező, olajmező, erdő (látható jelöléssel).
  Kitermelő (bánya, olajkút, fatelep) csak lelőhelyre kerülhet, feldolgozó
  (gyár, erőmű, raktár) bárhová — így a távolság és a szállítás kihívás marad.
- Opcionálisan: a lelőhely kimerülhet / lassulhat.
- A városok fixek maradnak (ők a fogyasztók).
- Jól illik a mikro nézethez és a „lyukból induló bánya” B tervhez: a saját
  gyáradat rendezed be belülről.

## Terv: a város belső (mikro) nézete

> A felhasználó jóváhagyta irányként („ez mehet a tervekbe”). Kint Transport
> Tycoon, bent egy kicsi, letisztult Cities: Skylines / Mini Motorways.

- **Kint a város csak bemeneti pont:** a városközpont oldalaira épített állomások /
  rakodók a belső város **kapui** (teherpályaudvar a város szélén).
- **Bent a város organikusan nő** (utcák, körzetek: lakó, bolt, munkahely) — nincs
  zónázás, nincs épületlerakás. A játékos a **hálózatot** építi: utak,
  kereszteződések, lámpák, körforgalmak, egyirányú utcák, megállók, sínek.
- **Áru: automatikus** (Mini Motorways-szerű): a kapuból kis teherautók maguktól
  viszik oda, ahol hiány van (boltok, üzemek; a deszka az építkezésekre). Nincs járat.
  Elosztóraktárak a körzetekben. Ellátatlan bolt bezár; az építkezés csak deszkával halad.
- **Utasok:** körzetek közötti forgalmi igény (nem egyenkénti emberek — gyors marad).
  Gyalog / tömegközlekedés / autó: a „legolcsóbbat” választják (gyalog + várakozás +
  utazás); az autók dugót okoznak, ami a teherautókat és a buszokat is lassítja.
  Tömegközlekedés **egyszerű vonalhúzással** (Mini Metro-szerű): busz (olcsó, dugóban
  ragad) → villamos (sín az utcában) → metró (föld alatt, drága, évekkel nyílik).
  Jegybevétel + üzemeltetés. Mérőszámok: lefedettség, utazási idő, zsúfoltság.
- **Kapcsolat a kinti játékkal:** elégedettség = áruellátás + közlekedés → növekedés →
  nagyobb kereslet a kapuknál. Később városok közti személyvonat (átszállás bent).
- **Sorrend (jóval később):** 1) belső város: utcák, körzetek, növekedés; 2) áruelosztás;
  3) utasigény + autóforgalom; 4) busz → villamos → metró. Az iparági belső nézettel
  együtt fejlődhet (közös rács / kapuk).

## Félretett apróságok (a bétateszt után, a felhasználó kérte, hogy maradjanak ötletnek)

- **Városkártya ne takarja a menüt:** közelről a város fölötti kártya óriásira nő, és a
  felső menü mögé / fölé kerül. Ötlet: maximális méret közelítéskor, a menü mindig fölötte.
- **Mentés letöltése / betöltése fájlként** (Játék panel): a tesztelők elküldhetik a
  mentésüket egy hiba mellé, így pontosan az az állapot visszajátszható.
- **Automatikus grafikai fokozat:** indításkor pár másodpercig mér, és ha nagyon akad,
  magától Energiatakarékosra vált (üzenettel; a Beállításokban visszaállítható).

## Sokszínű ipar: alapanyagok, áruk, láncok (ötlet, 2026-11)

Cél: sok áru, de **nem egyszerre** — a város növekedésével nyílnak az új láncok, a járművek
**rakománycsoportokat** visznek (nem egyes árukat), és van egy „mi miből lesz” lánctérkép.
Kb. 12–20 áru a felső határ.

**Rakománycsoportok (= kocsi / pótkocsi típus):**
- 🪨 ömlesztett (garatos kocsi, billencs): szén, érc, homok / kavics, mészkő, gabona
- 🛢️ folyékony (tartály): olaj, üzemanyag, víz?, tej?
- 🪵 rönk / hosszú (pőre kocsi): rönk, acél(rúd), cső
- 📦 darabáru (fedett kocsi, dobozos kamion): deszka, áru, élelmiszer, ruha, bútor, elektronika
- (később) 👥 utas — a város belső nézetével

**Alapanyagok (lelőhelyek a térképen):**
- Szén (bánya) · Vasérc (érc bánya) · Homok / kavics (bánya a folyónál) · Mészkő (kőfejtő, hegyen)
- Rönk (erdő → fatelep) · Gabona (farm) · Állat / tej (farm) · Gyapot? (farm)
- Olaj (olajfúró, tó / tenger)

**Láncok, lépcsőzetesen nyílnak (a város igényei hozzák):**
1. KEZDET (most is ez van): szén → erőmű → ⚡ áram · rönk → fatelep → deszka → város / gyár → áru
2. ÉLELEM: gabona → malom → liszt → pékség / élelmiszergyár → 🍞 élelmiszer → város;
   állat → vágóhíd → élelmiszer
3. ÉPÍTŐANYAG: mészkő + homok → cementgyár → cement → betonüzem → beton;
   vasérc + szén → kohó / acélmű → 🔩 acél (a város építkezései és az épületek építése kéri)
4. ÜZEMANYAG: olaj → finomító → ⛽ üzemanyag (a város kéri; később a járműveknek is) + műanyag
5. KÉSZÁRU: deszka + acél → bútorgyár → 🪑 bútor; gyapot → textilgyár → 👕 ruha;
   műanyag + acél (+ réz?) → elektronikai gyár → 📺 elektronika (a nagy városnak)

**A város igényei szintenként:** kisváros: áru, deszka, áram → közepes: + élelmiszer, üzemanyag,
cement / acél (építkezés) → nagy: + bútor, ruha, elektronika. Egy ellátatlan igény lassítja / megállítja
a növekedést (mint most az áram).

## Épületek anyagból (ötlet)

- Az iparág / állomás / raktár **tervét** veszed meg pénzért, az **anyagot oda kell szállítani**
  (deszka, cement / beton, acél) — az építkezés is szállítási feladat (Workers & Resources-szerű).
- Holtpont ellen: az első pár épület kész / van kezdő anyagkészlet; utak és sínek pénzből épülnek.
- Építési terület a térképen: állványzat, a készültség százalékban.

## Sínépítő vonat (ötlet, választható)

- Depóból induló sárga munkavonat a terven végigmegy és megépíti a sínt; az anyagot (sín, talpfa,
  zúzottkő) a depóba kell szállítani. Lassú → csak „valósághű építés” módban, vagy csak a nagy
  munkáknál (híd, alagút, hosszú vonal); a munkagép inkább látvány.

## Úttípusok (a felhasználó fixen szeretné — következő nagyobb lépés)

- **Földút**: olcsó, lassú, az elején csak ez van; a kamionok jobban kopnak (amíg nincs járműkopás:
  drágább üzemeltetés földúton).
- **Főút**: a mostani aszfalt.
- **Autópálya**: 2 sáv irányonként, gyors, drága, felhajtók — a forgalmi szimuláció most irányonként
  1 sávos, ezért ez külön, nagyobb lépés (sávváltás, előzés).
- Felújítás: a meglévő útra ráhúzva a jobb típus.
- Sorrend: földút + főút + felújítás → autópálya → (később) járműkopás / szerviz.

## Iparági rakodók a peron helyett (a felhasználó választotta: A irány, 2026-11)

Gond: a 6 széles gyár mellé tett 12 hosszú peron furán néz ki. Körzetes (vonzáskörzet) rendszer NEM kell.

- Minden iparágnak **saját, a modellbe épített rakodója** van: bánya = szénsiló garattal, fatelep =
  rönkdaru, gyár = rakodórámpák, erőmű = szénbuktató, olajfúró = töltőkar.
- A játékos csak a sínt / utat vezeti a rakodó alá, nincs külön kilógó peron.
- A vonat a rakodó alatt **lassan áthalad, és kocsinként tölt** (mint a valódi szénrakodóknál); a sín
  a telken túl is mehet (iparvágány), így mindegy, hány kocsis a vonat.
- A kamion a telekre hajt be a saját rakodóállásához (mint a raktárnál).
- A mikro nézettel összeillik: a rakodó maga a kapu, kint és bent ugyanaz a pont.
- Nyitott kérdés: fix oldal (a modell része) vagy választható oldal. Kidolgozás: előbb egy iparággal
  (pl. bánya) mintának.
- Kiegészítésnek később: futószalag / csővezeték egy szabadon lerakott állomáshoz (nagy hálózatokhoz).
- **Bővíthető rakodó** (a felhasználó ötlete, jóváhagyva): 1. szinten 1 garat / töltőcső = egyszerre
  1 kocsi; pénzért 2–3 garat egymás mellett = ennyi kocsi tölt egyszerre (kamionnál 1–3 rakodóállás).
  A rakodó a TÖLTÉS sebessége, az ipari szint a TERMELÉS — két külön fejlesztés. Nyitott: a garatsor a
  telken belül marad (max. 3) vagy kilóghat.
- **Rakodótábla**: a vonat úgy áll meg, hogy az első kocsi a garat alá kerüljön, onnan kocsinként
  gördül tovább. Előbb automatikusan (a rakodó része); később lerakható tábla, ha egy vonalon több
  rakodó is van (pl. szén + fa ugyanarra a vonatra).
