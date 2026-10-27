import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

const bundlePath = fileURLToPath(new URL('./.bundle/badges.js', import.meta.url));

type Harness = { mount: () => void; sync: () => void; count: () => number; destroy: () => void };

const harness = <T>(page: Page, fn: (h: Harness) => T): Promise<T> =>
  page.evaluate(
    (source) =>
      new Function('h', `return (${source})(h)`)(
        (globalThis as unknown as { VfeBadgeHarness: Harness }).VfeBadgeHarness,
      ) as T,
    fn.toString(),
  );

async function setup(page: Page, count: number, extra = ''): Promise<void> {
  const controls = Array.from({ length: count }, (_, index) => {
    const top = 40 + index * 46;
    return `<input data-vfe-id="vfe_${index + 1}" aria-label="Field ${index + 1}" style="position:absolute;top:${top}px;left:60px;width:240px;height:32px" />`;
  }).join('');
  await page.setContent(
    `<html><body style="margin:0;height:6000px">${controls}${extra}</body></html>`,
  );
  await page.addScriptTag({ path: bundlePath });
  await harness(page, (h) => {
    h.mount();
    h.sync();
  });
}

const badgeRect = (page: Page, index: number) =>
  page.evaluate((badgeIndex) => {
    const host = document.querySelector('vfe-badges') as HTMLElement;
    const node = host.shadowRoot?.querySelector(
      `[data-badge-index="${badgeIndex}"]`,
    ) as HTMLElement;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, index);

const inputRect = (page: Page, index: number) =>
  page.evaluate((badgeIndex) => {
    const node = document.querySelector(`[data-vfe-id="vfe_${badgeIndex}"]`) as HTMLElement;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  }, index);

test.describe('badge overlay', () => {
  test('numbers every control', async ({ page }) => {
    await setup(page, 12);
    expect(await harness(page, (h) => h.count())).toBe(12);
  });

  test('stays glued to its input while scrolling', async ({ page }) => {
    await setup(page, 40);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(100);
    for (const index of [1, 7, 13, 21, 33]) {
      const badge = await badgeRect(page, index);
      const input = await inputRect(page, index);
      expect(Math.abs(badge.x + 20 - input.x)).toBeLessThan(16);
      expect(Math.abs(badge.y + 20 - input.y)).toBeLessThan(16);
    }
  });

  test('repositions after a resize', async ({ page }) => {
    await setup(page, 10);
    const before = await badgeRect(page, 3);
    await page.setViewportSize({ width: 700, height: 600 });
    await page.waitForTimeout(100);
    const after = await badgeRect(page, 3);
    const input = await inputRect(page, 3);
    expect(after).not.toEqual(before);
    expect(Math.abs(after.x + 20 - input.x)).toBeLessThan(16);
  });

  test('follows an expanding accordion', async ({ page }) => {
    await setup(
      page,
      3,
      '<div id="panel" style="height:0;overflow:hidden;transition:height 250ms">' +
        '<input data-vfe-id="vfe_1" aria-label="Hidden field" style="display:block;height:32px" /></div>',
    );
    await harness(page, (h) => h.sync());
    const before = await badgeRect(page, 1);
    await page.evaluate(() => {
      const panel = document.getElementById('panel') as HTMLElement;
      panel.style.height = '120px';
    });
    await page.waitForTimeout(400);
    const after = await badgeRect(page, 1);
    expect(after.y).not.toBe(before.y);
  });

  test('is unaffected by host CSS resets', async ({ page }) => {
    await setup(
      page,
      6,
      '<style>* { transform: none !important; } input { box-shadow: none; }</style>',
    );
    const badge = await badgeRect(page, 2);
    const input = await inputRect(page, 2);
    expect(Math.abs(badge.x + 20 - input.x)).toBeLessThan(16);
    expect(Math.round(badge.width)).toBe(20);
  });

  test('renders above a near-maximum overlay', async ({ page }) => {
    await setup(
      page,
      5,
      '<div style="position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.1)"></div>',
    );
    const topmost = await page.evaluate(() => {
      const host = document.querySelector('vfe-badges') as HTMLElement;
      const node = host.shadowRoot?.querySelector('[data-badge-index="1"]') as HTMLElement;
      const rect = node.getBoundingClientRect();
      const root = host.shadowRoot as ShadowRoot & {
        elementFromPoint?: (x: number, y: number) => Element | null;
      };
      const hit = root.elementFromPoint?.(rect.x + 10, rect.y + 10) ?? null;
      return { isBadge: hit === node, z: getComputedStyle(host).zIndex };
    });
    expect(topmost).toEqual({ isBadge: true, z: '2147483646' });
  });

  test('never steals a click from the page', async ({ page }) => {
    await setup(page, 4);
    await page.evaluate(() => {
      const input = document.querySelector('[data-vfe-id="vfe_1"]') as HTMLElement;
      input.addEventListener('click', () => input.setAttribute('data-clicked', 'true'));
    });
    const badge = await badgeRect(page, 1);
    await page.mouse.click(badge.x + 10, badge.y + 10);
    const clicked = await page.evaluate(() =>
      document.querySelector('[data-vfe-id="vfe_1"]')?.getAttribute('data-clicked'),
    );
    expect(clicked).toBe('true');
  });

  test('renders 100 badges without missing frames while scrolling', async ({ page }) => {
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
    expect(fps).toBeGreaterThan(45);
  });
});
