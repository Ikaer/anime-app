/**
 * Regenerates the README screenshots in docs/screenshots/.
 *
 * Usage:
 *   1. Start the dev server:   npm run dev
 *   2. In another terminal:    npm run screenshots
 *
 * Options (env vars):
 *   BASE_URL     dev server origin (default http://localhost:3000)
 *   LANG_OVERRIDE  UI language, 'en' or 'fr' (default 'en')
 *   DETAIL_ID    MAL id used for the detail-page shot (default 5114 = FMA: Brotherhood)
 *   STUDIO_ID    MAL studio id used for the credits shot (default 11 = Madhouse)
 *
 * Requires playwright's chromium: `npx playwright install chromium` (one-time).
 */
const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const LANG = process.env.LANG_OVERRIDE || 'en';
const DETAIL_ID = process.env.DETAIL_ID || '5114';
const STUDIO_ID = process.env.STUDIO_ID || '11';

const shots = [
  { name: '01-card-view',       url: '/' },
  { name: '02-recommendations', url: '/recommendations', settle: 2500 },
  { name: '03-tier-list',       url: '/tier',            settle: 2500 },
  { name: '04-discrepancies',   url: '/discrepancies',   settle: 2500 },
  { name: '05-detail',          url: `/anime/${DETAIL_ID}`, settle: 2500, full: true },
  { name: '06-credits',         url: `/credits/studio/${STUDIO_ID}`, settle: 1500 },
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // pick UI language before any app code runs
  await page.addInitScript((lang) => {
    try { localStorage.setItem('anime-app.lang', lang); } catch (e) {}
  }, LANG);

  for (const s of shots) {
    try {
      await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(1500 + (s.settle || 0));
      const file = path.join(OUT, s.name + '.png');
      await page.screenshot({ path: file, fullPage: !!s.full });
      console.log('OK  ', s.name, '->', file);
    } catch (e) {
      console.log('FAIL', s.name, e.message);
      process.exitCode = 1;
    }
  }

  await browser.close();
})();
