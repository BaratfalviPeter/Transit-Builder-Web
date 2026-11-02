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
