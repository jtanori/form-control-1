// @vitest-environment node
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the Playwright harness bundles: the entry installs its
 * API on `globalThis`, so if esbuild is given a `globalName` it emits
 * `var Harness = <exports>` and silently clobbers that object. The browser
 * suites then fail with "cannot read properties of undefined".
 *
 * esbuild needs a Node realm, so the bundle is built here and evaluated in a
 * fresh JSDOM window: exactly what `page.addScriptTag()` does in Chromium.
 */
async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`./browser/${entry}`, import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    logLevel: 'silent',
  });
  const contents = result.outputFiles?.[0]?.contents;
  if (!contents) throw new Error(`esbuild produced no output for ${entry}`);
  return new TextDecoder().decode(contents);
}

function windowWith(code: string): JSDOM {
  const dom = new JSDOM('<html><body><input data-vfe-id="vfe_1" /></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  dom.window.eval(code);
  return dom;
}

interface HudHarness {
  mount: () => void;
  setStatus: (status: string) => void;
  events: Array<{ type: string }>;
}

interface BadgeHarness {
  mount: () => void;
  sync: () => void;
  count: () => number;
  destroy: () => void;
}

describe('Playwright harness bundles', () => {
  it('installs and drives the HUD harness', async () => {
    const dom = windowWith(await bundle('hud-entry.ts'));
    const harness = (dom.window as unknown as { VfeHudHarness?: HudHarness }).VfeHudHarness;
    expect(harness).toBeTruthy();

    harness?.mount();
    harness?.setStatus('listening');
    const host = dom.window.document.querySelector('vfe-hud');
    expect(host).toBeTruthy();
    expect(host?.shadowRoot?.querySelector('.pill')?.getAttribute('data-state')).toBe('listening');
    harness?.mount();
    expect(dom.window.document.querySelectorAll('vfe-hud')).toHaveLength(1);
  });

  it('installs and drives the badge harness', async () => {
    const dom = windowWith(await bundle('badges-entry.ts'));
    const harness = (dom.window as unknown as { VfeBadgeHarness?: BadgeHarness }).VfeBadgeHarness;
    expect(harness).toBeTruthy();

    const input = dom.window.document.querySelector('[data-vfe-id="vfe_1"]') as HTMLElement;
    Object.defineProperty(input, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 100,
        bottom: 130,
        left: 40,
        right: 240,
        width: 200,
        height: 30,
        x: 40,
        y: 100,
        toJSON: () => ({}),
      }),
    });

    harness?.mount();
    harness?.sync();
    expect(harness?.count()).toBe(1);
    harness?.destroy();
    expect(dom.window.document.querySelectorAll('vfe-badges')).toHaveLength(0);
  });
});
