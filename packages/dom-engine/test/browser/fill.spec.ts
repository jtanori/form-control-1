import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

// Playwright loads specs as ESM (`"type": "module"`), where `__dirname` does not exist.
const bundle = readFileSync(
  fileURLToPath(new URL('./.bundle/dom-engine.js', import.meta.url)),
  'utf8',
);

declare global {
  interface Window {
    VfeDomEngine: {
      fillValue: (
        targetId: string,
        value: string,
        options?: Record<string, unknown>,
      ) => Promise<{
        ok: boolean;
        error?: { code: string };
        warnings: string[];
      }>;
      setChecked: (targetId: string, checked: boolean) => Promise<{ ok: boolean }>;
    };
    __events: string[];
    __state: Record<string, string>;
  }
}

async function setup(page: Page): Promise<void> {
  await page.addScriptTag({ content: bundle });
}

test('a controlled component (tracker + instance setter) sees onChange', async ({ page }) => {
  await setup(page);
  await page.setContent(`
    <input id="name" />
    <pre id="dump"></pre>
    <script>
      window.__events = [];
      window.__state = { name: '' };
      const input = document.getElementById('name');
      input.setAttribute('data-vfe-id', 'vfe_1');
      // Mimic React: an instance-level setter + a value tracker.
      let tracked = '';
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return proto.get.call(this); },
        set(next) { tracked = next; proto.set.call(this, next); },
      });
      input._valueTracker = { setValue() { tracked = ''; } };
      input.addEventListener('input', () => {
        window.__events.push('input:' + input.value + ':tracked=' + tracked);
        window.__state.name = input.value;
        document.getElementById('dump').textContent = JSON.stringify(window.__state);
      });
    </script>
  `);

  const result = await page.evaluate(() =>
    window.VfeDomEngine.fillValue('vfe_1', 'Alice', { scroll: false, blur: false }),
  );

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => window.__events.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__state.name)).toBe('Alice');
  expect(await page.textContent('#dump')).toContain('Alice');
});

test('a pointerdown-only widget responds to the full pointer sequence', async ({ page }) => {
  await setup(page);
  await page.setContent(`
    <div id="widget" role="checkbox" aria-checked="false" data-vfe-id="vfe_2"
         style="width:120px;height:32px">Toggle</div>
    <script>
      const widget = document.getElementById('widget');
      // Ignores click entirely: only pointerdown counts.
      widget.addEventListener('pointerdown', () => {
        widget.setAttribute('aria-checked', widget.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
      });
    </script>
  `);

  const result = await page.evaluate(() => window.VfeDomEngine.setChecked('vfe_2', true));
  expect(result.ok).toBe(true);
  expect(await page.getAttribute('#widget', 'aria-checked')).toBe('true');
});

test('40 fields fill in under 6 seconds with default options', async ({ page }) => {
  await setup(page);
  const fields = Array.from(
    { length: 40 },
    (_, i) => `<input id="f${i}" data-vfe-id="vfe_${i + 1}" />`,
  ).join('');
  await page.setContent(`<form>${fields}</form>`);

  const started = Date.now();
  const result = await page.evaluate(async () => {
    const outcomes: boolean[] = [];
    for (let i = 0; i < 40; i += 1) {
      const outcome = await window.VfeDomEngine.fillValue(`vfe_${i + 1}`, `value ${i}`);
      outcomes.push(outcome.ok);
    }
    return outcomes.every(Boolean);
  });
  expect(result).toBe(true);
  expect(Date.now() - started).toBeLessThan(6000);
  expect(await page.inputValue('#f39')).toBe('value 39');
});
