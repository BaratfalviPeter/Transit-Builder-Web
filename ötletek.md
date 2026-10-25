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

- **Minden iparnak saját, a modelljéhez illő belső tere:** ne egy általános
  rács legyen, hanem a bánya belseje a valódi gödör, a fatelepé a fűrésztelep
  udvara, az olajfúróé a fedélzet stb.
- **Többsávos futószalagok:** egy szalagon két (vagy több) sáv, külön árukkal.

## További irányok (a megbeszélt sorrend után)

- Teherautók az utakon, teherautó-rakodó a telkek oldalán.
- A város növekedése függjön az áruellátástól (áru, utasok).
- Hidak a folyók fölött.
- Új járműtípusok az évek múlásával (a játék 1970-ben indul).
