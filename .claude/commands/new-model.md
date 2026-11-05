---
description: Új low poly modell készítése referenciaképből builder + reviewer körökkel
argument-hint: <ModelName> <referenciakép útvonala> [rövid leírás]
---

Készíts új low poly modellt ezekből: $ARGUMENTS

Az első szó a modell neve (`…Model`-re végződjön, pl. `SawmillModel`), a második a referenciakép
útvonala (pl. `ref/sawmill.png`), a többi egy rövid leírás.

## Lépések
1. Ellenőrizd, hogy fut-e a dev szerver (`curl -s -o /dev/null -w "%{http_code}" http://localhost:5173`).
   Ha nem fut, szólj, hogy indítsam el az `npm run dev` paranccsal, és állj meg. (Felhős gépen
   magad is elindíthatod a háttérben: `npx vite --port 5173`; leállítás: `pkill -f "[v]ite --port 5173"`.)
   Ha a Vite másik portra lépett (foglalt volt az 5173), a render scriptnek add meg a címet 3.
   paraméterként.
2. Hívd a **model-builder** subagentet: első kör, referenciakép, leírás, modellnév.
3. Ismételd legfeljebb 4 körig (N = 1, 2, 3, 4):
   a. Renderelés: `node scripts/render-model.mjs <ModelName> round-N`
      (5 kép: iso, front, side, back, top, 1024×1024; ha a script „ÜRESNEK TŰNIK” vagy „HIBA” üzenettel
      nem nullával lép ki, előbb ezt javíttasd a builderrel).
   b. Hívd a **model-reviewer** subagentet a referenciaképpel, a `renders/<ModelName>/round-N/` képekkel és a parts.md-vel. Ha N > 1, add meg az előző kör mappáját is összehasonlításnak.
   c. Ha `VERDICT: ACCEPT`, állj meg.
   d. Különben add tovább a hibalistát a **model-builder**nek javító körként.
4. A végén írd meg: hány kör kellett, a végső renderek mappáját, a reviewer utolsó véleményét, és azokat a feltételezéseket a parts.md-ből, amiket érdemes ellenőriznem.
   A `renders/` mappa nincs verziókezelve (`.gitignore`).
