import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

const bundlePath = fileURLToPath(new URL('./.bundle/badges.js', import.meta.url));

type Point = { x: number; y: number };

declare global {
  interface Window {
    VfeBadgeHarness: {
      mount: () => void;
      sync: () => void;
      count: () => number;
      destroy: () => void;
    };
  }
}

async function setup(page: Page, count: number, extra = ''): Promise<void> {
  const controls = Array.from({ length: count }, (_, index) => {
    const top = 40 + index * 46;
    return `<input data-vfe-id="vfe_${index + 1}" aria-label="Field ${index + 1}" style="position:absolute;top:${top}px;left:60px;width:240px;height:32px" />`;
  }).join('');
  await page.setContent(
    `<html><body style="margin:0;height:6000px">${controls}${extra}</body></html>`,
  );
  await page.addScriptTag({ path: bundlePath });
  await page.evaluate(() => {
    window.VfeBadgeHarness.mount();
    window.VfeBadgeHarness.sync();
  });
}

const badgePoint = (page: Page, vfeId: string): Promise<Point | null> =>
  page.evaluate((id) => {
    const host = document.querySelector('vfe-badges') as HTMLElement;
    const node = host.shadowRoot?.querySelector(`[data-vfe-id="${id}"]`) as HTMLElement | null;
    if (!node || node.dataset.visible !== 'true') return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  }, vfeId);

const inputPoint = (page: Page, vfeId: string): Promise<Point> =>
  page.evaluate((id) => {
    const node = document.querySelector(`[data-vfe-id="${id}"]`) as HTMLElement;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  }, vfeId);

const BADGE_SIZE = 20;

async function expectGlued(page: Page, vfeId: string): Promise<void> {
  const badge = await badgePoint(page, vfeId);
  const input = await inputPoint(page, vfeId);
  expect(badge, `badge for ${vfeId} should be visible`).not.toBeNull();
  expect(Math.abs((badge as Point).x + BADGE_SIZE - input.x)).toBeLessThan(16);
  expect(Math.abs((badge as Point).y + BADGE_SIZE - input.y)).toBeLessThan(16);
}

test.describe('badge overlay', () => {
  test('numbers every control', async ({ page }) => {
    await setup(page, 12);
    const numbers = await page.evaluate(() => {
      const host = document.querySelector('vfe-badges') as HTMLElement;
      const nodes = Array.from(host.shadowRoot?.querySelectorAll('.badge') ?? []);
      return nodes.map((node) => node.textContent);
    });
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, index) => String(index + 1)));
    expect(await page.evaluate(() => window.VfeBadgeHarness.count())).toBe(12);
  });

  test('stays glued to its input while scrolling', async ({ page }) => {
    await setup(page, 40);
    // Rows sit at 40 + n * 46 px, so these are on screen before scrolling.
    for (const index of [1, 5, 9, 13]) await expectGlued(page, `vfe_${index}`);
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(200);
    // After a 400 px scroll these rows are the ones inside the viewport.
    for (const index of [12, 16, 20, 23]) await expectGlued(page, `vfe_${index}`);
  });

  test('re-glues after a viewport resize', async ({ page }) => {
    await setup(page, 10);
    await page.setViewportSize({ width: 700, height: 600 });
    await page.waitForTimeout(150);
    await expectGlued(page, 'vfe_1');
    const badge = (await badgePoint(page, 'vfe_1')) as Point;
    expect(badge.x).toBeGreaterThanOrEqual(2);
    expect(badge.y).toBeGreaterThanOrEqual(2);
  });

  test('follows an expanding accordion', async ({ page }) => {
    // A collapsing panel above a field in normal flow: expanding it must push
    // that field (and its badge) down while the transition runs.
    await page.setContent(`
      <html><body style="margin:0">
        <div id="panel" style="height:0;overflow:hidden;transition:height 250ms">
          <input data-vfe-id="vfe_panel" aria-label="Panel field" style="display:block;height:32px" />
        </div>
        <input data-vfe-id="vfe_below" aria-label="Below field" style="display:block;height:32px" />
      </body></html>
    `);
    await page.addScriptTag({ path: bundlePath });
    await page.evaluate(() => {
      window.VfeBadgeHarness.mount();
      window.VfeBadgeHarness.sync();
    });

    const before = (await badgePoint(page, 'vfe_below')) as Point;
    await page.evaluate(() => {
      (document.getElementById('panel') as HTMLElement).style.height = '120px';
    });
    await page.waitForTimeout(400);
    const after = (await badgePoint(page, 'vfe_below')) as Point;
    expect(after.y).toBeGreaterThan(before.y + 80);
    await expectGlued(page, 'vfe_below');
  });

  test('is unaffected by host CSS resets', async ({ page }) => {
    await setup(
      page,
      6,
      '<style>* { transform: none !important; } input { box-shadow: none; }</style>',
    );
    await expectGlued(page, 'vfe_2');
    const width = await page.evaluate(() => {
      const host = document.querySelector('vfe-badges') as HTMLElement;
      const node = host.shadowRoot?.querySelector('.badge') as HTMLElement;
      return node.getBoundingClientRect().width;
    });
    expect(Math.round(width)).toBe(BADGE_SIZE);
  });

  test('renders above a near-maximum overlay', async ({ page }) => {
    await setup(
      page,
      5,
      '<div style="position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.1)"></div>',
    );
    const stacking = await page.evaluate(() => {
      const host = document.querySelector('vfe-badges') as HTMLElement;
      const node = host.shadowRoot?.querySelector('[data-vfe-id="vfe_1"]') as HTMLElement;
      const rect = node.getBoundingClientRect();
      const x = rect.x + 10;
      const y = rect.y + 10;
      const root = host.shadowRoot as ShadowRoot & {
        elementFromPoint?: (px: number, py: number) => Element | null;
      };

      // By design the overlay is click-through, and hit testing ignores
      // `pointer-events: none` elements — so the page overlay wins the probe.
      const passthrough = document.elementFromPoint(x, y)?.getAttribute('style') ?? '';

      // Flip pointer events for one probe to measure paint order instead.
      node.style.pointerEvents = 'auto';
      const hit = root.elementFromPoint?.(x, y) ?? null;
      node.style.pointerEvents = '';
      return {
        passesThrough: passthrough.includes('z-index:2147483645'),
        isBadge: hit === node,
        z: getComputedStyle(host).zIndex,
      };
    });
    expect(stacking).toEqual({ passesThrough: true, isBadge: true, z: '2147483646' });
  });

  test('never steals a click from the page', async ({ page }) => {
    await setup(page, 4);
    await page.evaluate(() => {
      const input = document.querySelector('[data-vfe-id="vfe_1"]') as HTMLElement;
      input.addEventListener('click', () => input.setAttribute('data-clicked', 'true'));
    });
    const badge = (await badgePoint(page, 'vfe_1')) as Point;
    // Four pixels inside the control, straight under the badge.
    await page.mouse.click(badge.x + 10, badge.y + 14);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.querySelector('[data-vfe-id="vfe_1"]')?.getAttribute('data-clicked'),
        ),
      )
      .toBe('true');
  });

  test('keeps up with 100 badges while scrolling', async ({ page }) => {
    await setup(page, 100);
    const fps = await page.evaluate(async () => {
      const frames: number[] = [];
      let last = performance.now();
      let running = true;
      const sample = (): void => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        if (running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      const start = performance.now();
      while (performance.now() - start < 1500) {
        window.scrollBy(0, 12);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      running = false;
      const total = frames.reduce((sum, value) => sum + value, 0);
      return frames.length / (total / 1000);
    });
    expect(fps).toBeGreaterThan(40);
  });
});
