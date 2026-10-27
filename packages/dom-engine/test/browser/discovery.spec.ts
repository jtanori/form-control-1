import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const bundle = readFileSync(join(__dirname, '.bundle/dom-engine.js'), 'utf8');

interface Summary {
  elements: Array<{ vfeId: string; badgeIndex: number; tag: string; htmlType: string | null }>;
  durationMs: number;
  reasons: string[];
}

declare global {
  interface Window {
    VfeDomEngine: {
      discoverInteractiveElements: (options?: Record<string, unknown>) => {
        elements: Array<{
          vfeId: string;
          badgeIndex: number;
          element: Element;
          tag: string;
          htmlType: string | null;
        }>;
        excluded: Array<{ reason: string }>;
        durationMs: number;
      };
      clearVfeTags: () => void;
    };
  }
}

async function discover(page: Page, options: Record<string, unknown> = {}): Promise<Summary> {
  return page.evaluate((opts) => {
    const result = window.VfeDomEngine.discoverInteractiveElements(opts);
    return {
      elements: result.elements.map((entry) => ({
        vfeId: entry.vfeId,
        badgeIndex: entry.badgeIndex,
        tag: entry.tag,
        htmlType: entry.htmlType,
      })),
      durationMs: result.durationMs,
      reasons: result.excluded.map((entry) => entry.reason),
    };
  }, options);
}

test.beforeEach(async ({ page }) => {
  await page.addScriptTag({ content: bundle });
});

test('uses real layout: below the fold is visible, display:none and 0×0 are not', async ({
  page,
}) => {
  await page.setContent(`
    <main style="height: 3000px">
      <input id="top" />
      <input id="hidden" style="display:none" />
      <button id="zero" style="width:0;height:0;padding:0;border:0"></button>
      <div style="margin-top: 2500px">
        <input id="below" />
      </div>
    </main>
  `);

  const summary = await discover(page);
  expect(summary.elements.map((entry) => entry.tag)).toEqual(['input', 'input']);
  expect(summary.reasons).toEqual(expect.arrayContaining(['display-none', 'zero-size']));
});

test('discovers 500 inputs within the performance budget (CI ×3)', async ({ page }) => {
  const inputs = Array.from({ length: 500 }, (_, i) => `<input id="i${i}" />`).join('');
  await page.setContent(`<form>${inputs}</form>`);

  const summary = await discover(page, { maxElements: 600 });
  expect(summary.elements).toHaveLength(500);
  expect(summary.durationMs).toBeLessThan(120);
});

test('scrolling does not change the discovered set or IDs', async ({ page }) => {
  await page.setContent(`
    <main style="height: 4000px">
      <input id="a" />
      <input id="b" style="margin-top: 2000px" />
    </main>
  `);

  const before = await discover(page);
  await page.evaluate(() => window.scrollTo(0, 2500));
  const after = await discover(page);

  expect(after.elements.map((entry) => entry.vfeId)).toEqual(
    before.elements.map((entry) => entry.vfeId),
  );
  expect(after.elements.map((entry) => entry.badgeIndex)).toEqual([1, 2]);
});
