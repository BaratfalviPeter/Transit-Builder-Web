// Használat: node scripts/render-model.mjs <ModelId> [round-N] [baseUrl]
//   ModelId: a modellnéző `VIEWER_MODELS` listájának `id`-je (src/dev/ModelViewer.tsx),
//            pl. MineModel, LumberMillModel, FactoryModel, Depot, Truck.
// Előfeltétel: fut a dev szerver (`npm run dev` → http://localhost:5173; ha a port foglalt,
// a Vite a következőre lép — akkor add meg a baseUrl-t), és a modell regisztrálva van.
// Kimenet: renders/<ModelId>/<round-N>/{iso,front,side,back,top}.png (1024×1024).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [model, round = 'round-1', base = 'http://localhost:5173'] = process.argv.slice(2);
if (!model) {
  console.error('Használat: node scripts/render-model.mjs <ModelId> [round-N] [baseUrl]');
  process.exit(1);
}

// A modellnéző VIEWS listája (ModelViewer.tsx): a kamera a +Z oldalról nézi az „elöl” nézetet.
const views = ['iso', 'front', 'side', 'back', 'top'];
const outDir = join('renders', model, round);
mkdirSync(outDir, { recursive: true });

// GPU nélkül (felhős gép, CI) szoftveres WebGL; Macen is működik.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error(`[oldalhiba] ${e.message}`));

let failed = false;
for (const view of views) {
  const url = `${base}/?model=${encodeURIComponent(model)}&view=${view}&ui=0`;
  await page.goto(url, { waitUntil: 'load' });
  // A néző néhány kirajzolt képkocka után beállítja: <body data-viewer-ready="<id>:<view>">.
  // Ismeretlen id-nél a néző csendben az első modellt mutatná — ezt itt elkapjuk.
  const ready = await page
    .waitForFunction(() => document.body.dataset.viewerReady, null, { timeout: 60000 })
    .then((h) => h.jsonValue());
  if (ready !== `${model}:${view}`) {
    console.error(`HIBA: a néző „${ready}”-t mutat, nem „${model}:${view}”-t — nincs ilyen modell a VIEWER_MODELS-ben?`);
    process.exit(2);
  }
  await page.waitForTimeout(300); // árnyék és első animációs lépés
  const file = join(outDir, `${view}.png`);
  const png = await page.screenshot({ path: file });

  // Üres-e a kép? Azon képpontok aránya, amelyek sem a bal felső (ég / gyep), sem a bal alsó
  // sarok (gyep / víz) színére nem hasonlítanak.
  const share = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const bl = (c.height - 1) * c.width * 4;
    const bg = [[d[0], d[1], d[2]], [d[bl], d[bl + 1], d[bl + 2]]];
    let diff = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      if (bg.every(([r, g, b]) => Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) > 60)) diff++;
    }
    return diff / (d.length / (4 * 7));
  }, png.toString('base64'));
  const pct = Math.round(share * 100);
  const empty = pct < 3;
  if (empty) failed = true;
  console.log(`kész: ${file}  (modell a kép ~${pct}%-án${empty ? ' — ÜRESNEK TŰNIK!' : ''})`);
}

await browser.close();
if (failed) process.exit(3);
