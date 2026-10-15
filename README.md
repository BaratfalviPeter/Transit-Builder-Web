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
            #   types.ts   – alap típusok (GridCoord, Placement, …)
            #   grid.ts    – world <-> cell koordináta konverzió
            #   World.ts   – mérvadó játékállapot, foglaltság, subscribe
            #   useWorld.ts – vékony React-híd (provider + snapshot hook)
  render/   # R3F komponensek
            #   GameCanvas – gyökér jelenet, click -> snap-to-grid -> World
            #   GridFloor  – rács padló + láthatatlan pick-sík
            #   CameraRig  – RTS kamera (drei MapControls)
            #   BuildingModel – EGYETLEN, cserélhető épület-vizuál (placeholder)
            #   Buildings  – a World placements kirajzolása
            #   config.ts  – cellSize és egyéb render beállítások
  ui/       # React HUD (épületszám, hint)
  App.tsx
  main.tsx
public/
  models/   # ide kerülnek a .obj/.glb modellek (lásd models/README.md)
```

### Teljesítmény-elv

A sok mozgó jármű **nem** React re-renderen keresztül fog frissülni, hanem a
Three.js render-loopban (`useFrame`) + instancing-gal. A React csak a diszkrét
eseményekre (épület le-/felrakás) renderel újra, a `useWorldSnapshot()` hookon
keresztül.

## Futtatás

```bash
npm install
npm run dev        # fejlesztői szerver
npm run build      # típusellenőrzés + production build
npm run preview    # buildelt verzió kiszolgálása
```

## Vezérlés

- **Bal klikk** a padlón: ház (placeholder kocka) lerakása a legközelebbi
  rácspontra. Egy cellán csak egy objektum lehet.
- **Bal húzás**: pásztázás (pan)
- **Jobb húzás**: forgatás
- **Görgő**: zoom

A rács `cellSize` értéke a `src/render/config.ts`-ben állítható.
