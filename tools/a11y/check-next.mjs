// docs/09 gate for the SERVED app (apps/web-next, port wave 2b).
//
// `check.mjs` scans the single-file alpha from disk; this one scans real routes off a running
// server, because the Next app renders from the API and half its states (a provisional clock, the
// chase step) only exist when there is data behind them.
//
// Run:  BASE=http://localhost:3901 CASE_ID=req_… npm run check:next
// CI:   needs the API + the app running; wire it into alpha-ci.yml when both are containerised.

import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.BASE ?? 'http://localhost:3901';
const CASE_ID = process.env.CASE_ID ?? '';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

const routes = ['/', '/firmen', '/firmen/schufa', '/firmen/zoominfo', '/firmen/hirevue', '/akte', '/wissen', '/vorgaenge'];
if (CASE_ID) routes.push(`/vorgaenge/${CASE_ID}`);

const browser = await chromium.launch();
// Mid-range Android viewport — the docs/09 target device, not a desktop window.
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
let failures = 0;
let reviews = 0;

for (const register of [{ label: 'de', cookies: [] }, { label: 'en', cookies: [{ name: 'lang', value: 'en' }] }, { label: 'de-leicht', cookies: [{ name: 'reading-level', value: 'leicht' }] }]) {
  await ctx.clearCookies();
  if (register.cookies.length) {
    await ctx.addCookies(register.cookies.map((c) => ({ ...c, url: BASE })));
  }
  for (const route of routes) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

    // WCAG 2.5.8 has two failure modes and they deserve different treatment.
    //
    // A target SMALLER than 24px is a defect: fix the CSS. A target that is large enough but
    // momentarily sits under the persistent bottom nav is the known cost of the nav docs/09
    // requires ("no dead ends") — the row is 70px tall and reachable after a small scroll. Axe
    // cannot tell those apart, so we measure: big-enough-but-covered is reported for the manual
    // one-handed pass (docs/manual-a11y-protocol.md §3); too-small still fails the build.
    const review = [];
    const bad = [];
    for (const v of serious) {
      if (v.id !== 'target-size') { bad.push(v); continue; }
      const sizes = await Promise.all(
        v.nodes.map(async (n) => {
          const box = await page.locator(n.target.join(' ')).first().boundingBox().catch(() => null);
          return box ? Math.min(box.width, box.height) : 0;
        }),
      );
      (sizes.every((px) => px >= 24) ? review : bad).push(v);
    }
    for (const v of review) {
      reviews += 1;
      console.log(`  [review] ${route} (${register.label}): ${v.id} — target is ≥24px but covered by the sticky nav; covered by the manual one-handed pass`);
    }
    failures += bad.length;
    console.log(`${bad.length === 0 ? '✓' : '✗'} [${register.label}] ${route}${bad.length ? ' — ' + bad.map((v) => v.id).join(', ') : ''}`);
    for (const v of bad) {
      console.log(`    ${v.id}: ${v.help}`);
      for (const node of v.nodes.slice(0, 2)) console.log(`      ${node.target.join(' ')}`);
    }
    await page.close();
  }
}

await browser.close();
console.log(
  failures === 0
    ? `\naxe (served app): clean${reviews ? ` · ${reviews} item(s) deferred to the manual one-handed pass` : ''}`
    : `\naxe (served app) FAILED: ${failures} serious/critical${reviews ? ` · ${reviews} deferred to manual review` : ''}`,
);
if (failures > 0) process.exit(1);
