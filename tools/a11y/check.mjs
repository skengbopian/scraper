// docs/09 usability gate: automated axe scan (WCAG 2.2 AA tags) over every view of the alpha UI,
// both themes, plus Leichte Sprache. Fails (exit 1) on any serious/critical violation.
//
// Honest scope note: automated axe covers roughly a third of WCAG — screen-reader flows, one-handed
// reach and mid-range-Android checks stay a manual pre-launch gate (docs/09 §5). A green run here is
// "no known automatic violations", not "WCAG 2.2 AA done".
//
// Run:  cd tools/a11y && npm install && npx playwright install chromium && npm run check

import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page_ = resolve(here, '../../apps/web/index.html');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const VIEWS = ['start', 'firmen', 'flow', 'vorgang'];
const THEMES = ['light', 'dark'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); // mid-range Android
let failures = 0;
const scan = async (label, url, prepare) => {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(600); // needle/view animations settle; API probe times out offline
  if (prepare) await prepare(page);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const minor = results.violations.length - bad.length;
  console.log(`${bad.length === 0 ? '✓' : '✗'} ${label}: ${bad.length} serious/critical, ${minor} moderate/minor`);
  for (const v of bad) {
    failures++;
    console.log(`   [${v.impact}] ${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }
  await page.close();
};

for (const theme of THEMES) {
  for (const view of VIEWS) {
    await scan(`${view} (${theme})`, `file://${page_}#v=${view}&t=${theme}`);
  }
}
// Leichte Sprache + the decision screen (both engine-outcome shapes).
await scan('start (light, Leichte Sprache)', `file://${page_}#v=start&t=light`, async (p) => {
  await p.click('#lsBtn');
  await p.waitForTimeout(200);
});
await scan('firma zoominfo (light)', `file://${page_}#v=firma&t=light&f=zoominfo`);
await scan('firma hirevue (dark)', `file://${page_}#v=firma&t=dark&f=hirevue`);

await browser.close();
if (failures > 0) {
  console.error(`\naxe gate FAILED: ${failures} serious/critical violation(s).`);
  process.exit(1);
}
console.log('\naxe gate passed (automated subset of WCAG 2.2 AA — manual checks still required).');
