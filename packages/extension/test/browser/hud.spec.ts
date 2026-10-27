import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

const bundlePath = fileURLToPath(new URL('./.bundle/hud.js', import.meta.url));

const pill = 'vfe-hud >> .pill';

type Harness = {
  events: Array<{ type: string }>;
  mount: () => void;
  destroy: () => void;
  setStatus: (status: string) => void;
  setMessage: (text: string) => void;
};

declare global {
  interface Window {
    VfeHudHarness: Harness;
  }
}

async function inject(page: Page): Promise<void> {
  await page.addScriptTag({ path: bundlePath });
  await page.evaluate(() => window.VfeHudHarness.mount());
}

const status = (page: Page, value: string): Promise<void> =>
  page.evaluate((next) => window.VfeHudHarness.setStatus(next), value);

const events = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.VfeHudHarness.events.map((event) => event.type));

test.describe('HUD CSS isolation', () => {
  test('survives an aggressive host reset', async ({ page }) => {
    await page.setContent(
      '<html><body><h1>shop</h1><style>* { all: unset !important; } button { display: none !important; }</style></body></html>',
    );
    await inject(page);
    const box = await page.locator(pill).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(43);
    expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(43);
    await expect(page.locator(pill)).toBeVisible();
  });

  test('does not change host page styles', async ({ page }) => {
    await page.setContent('<html><body><h1 id="title">Dashboard</h1><p>content</p></body></html>');
    const snapshot = (): Promise<Record<string, string>> =>
      page.evaluate(() => {
        const heading = document.getElementById('title') as HTMLElement;
        const style = getComputedStyle(heading);
        return {
          font: style.font,
          margin: style.margin,
          color: style.color,
          display: style.display,
          padding: style.padding,
          lineHeight: style.lineHeight,
        };
      });
    const before = await snapshot();
    await inject(page);
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  test('stays above a max z-index overlay', async ({ page }) => {
    await page.setContent(
      '<html><body><div style="position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.2)"></div></body></html>',
    );
    await inject(page);
    const topmost = await page.evaluate(() => {
      const host = document.querySelector('vfe-hud') as HTMLElement;
      const pillElement = host.shadowRoot?.querySelector('.pill') as HTMLElement;
      const rect = pillElement.getBoundingClientRect();
      const root = host.shadowRoot as ShadowRoot & {
        elementFromPoint?: (x: number, y: number) => Element | null;
      };
      const hit = root.elementFromPoint?.(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { isPill: hit === pillElement, hostZ: getComputedStyle(host).zIndex };
    });
    expect(topmost).toEqual({ isPill: true, hostZ: '2147483647' });
  });

  test('is stable while scrolling', async ({ page }) => {
    await page.setContent('<html><body style="height:4000px"><h1>long page</h1></body></html>');
    await inject(page);
    const before = await page.locator(pill).boundingBox();
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(100);
    const after = await page.locator(pill).boundingBox();
    expect(Math.round(after?.y ?? 0)).toBe(Math.round(before?.y ?? 0));
    expect(Math.round(after?.x ?? 0)).toBe(Math.round(before?.x ?? 0));
  });

  test('honours prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent('<html><body><h1>calm</h1></body></html>');
    await inject(page);
    await status(page, 'listening');
    const animation = await page.evaluate(() => {
      const host = document.querySelector('vfe-hud') as HTMLElement;
      const bar = host.shadowRoot?.querySelector('.wave span') as HTMLElement;
      return getComputedStyle(bar).animationName;
    });
    expect(animation).toBe('none');
  });

  test('is keyboard operable', async ({ page }) => {
    await page.setContent('<html><body><h1>keys</h1></body></html>');
    await inject(page);
    await status(page, 'listening');
    await page.keyboard.press('Escape');
    await expect.poll(() => events(page)).toEqual(['hud:stop']);
  });
});
