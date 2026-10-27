import type { AgentStatus } from '@vfe/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bottomOffset } from '../src/content/hud/collision';
import { destroyHud, mountHud } from '../src/content/hud/mount';

function hudRoot(): ShadowRoot {
  const host = document.querySelector('vfe-hud');
  expect(host?.shadowRoot).toBeTruthy();
  return host?.shadowRoot as ShadowRoot;
}

function query<T extends Element>(selector: string): T {
  const element = hudRoot().querySelector<T>(selector);
  expect(element).toBeTruthy();
  return element as T;
}

afterEach(() => {
  destroyHud();
  vi.useRealTimers();
});

describe('mountHud', () => {
  it('is idempotent', () => {
    const first = mountHud();
    const second = mountHud();
    expect(second).toBe(first);
    expect(document.querySelectorAll('vfe-hud')).toHaveLength(1);
  });

  it('mounts a single open shadow root with scoped styles', () => {
    mountHud();
    const host = document.querySelector('vfe-hud');
    expect(host?.shadowRoot?.mode).toBe('open');
    const style = host?.shadowRoot?.querySelector('style');
    expect(style?.textContent).toContain(':host');
    expect(style?.textContent).toContain('prefers-reduced-motion');
    expect(style?.textContent).not.toContain('@import');
    expect(host?.style.zIndex).toBe('2147483647');
    expect(host?.style.position).toBe('fixed');
  });
});

describe('states', () => {
  it('renders copy and a state class for all six statuses', () => {
    const hud = mountHud();
    const expectations: Array<[AgentStatus, string]> = [
      ['idle', 'Ready'],
      ['listening', 'Listening…'],
      ['thinking', 'Mapping actions…'],
      ['executing', 'Working…'],
      ['clarifying', 'Clarification needed'],
      ['error', 'Something went wrong'],
    ];
    for (const [status, copy] of expectations) {
      hud.setStatus(status);
      expect(query('.pill').getAttribute('data-state')).toBe(status);
      expect(query('.title').textContent).toBe(copy);
      expect(hud.getStatus()).toBe(status);
    }
  });

  it('shows execution progress', () => {
    const hud = mountHud();
    hud.setStatus('executing');
    hud.setActionsProgress(2, 3);
    expect(query('.title').textContent).toBe('Filling 2 of 3…');
    expect(query('.progress .bar').style.width).toBe('66.66666666666666%');
  });

  it('shows the live transcript only while listening', () => {
    const hud = mountHud();
    hud.setStatus('listening');
    hud.setTranscript('my name is Al');
    expect(query('.transcript').textContent).toBe('my name is Al');
    expect(query('.transcript').getAttribute('aria-hidden')).toBe('true');
    hud.setStatus('thinking');
    expect(query('.transcript').textContent).toBe('');
  });

  it('keeps state transitions leak-free', () => {
    const hud = mountHud();
    for (let index = 0; index < 25; index += 1) {
      hud.setStatus('listening');
      hud.setStatus('thinking');
      hud.setStatus('executing');
      hud.setStatus('idle');
    }
    expect(document.querySelectorAll('vfe-hud')).toHaveLength(1);
    expect(hudRoot().querySelectorAll('.pill')).toHaveLength(1);
  });
});

describe('security', () => {
  it('renders untrusted text as text, never markup', () => {
    const hud = mountHud();
    hud.setMessage('<img src=x onerror=alert(1)>');
    expect(hudRoot().querySelector('img')).toBeNull();
    expect(query('.message').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('accessibility', () => {
  it('exposes a labelled button and a live region', () => {
    const hud = mountHud();
    const pill = query<HTMLButtonElement>('.pill');
    expect(pill.tagName).toBe('BUTTON');
    expect(pill.getAttribute('aria-label')).toContain('Voice form assistant: idle');
    expect(pill.getAttribute('aria-label')).toContain('Alt+V');
    const live = query('.live');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');

    hud.setStatus('listening');
    expect(pill.getAttribute('aria-label')).toContain('Escape');
    hud.setStatus('error');
    expect(live.getAttribute('aria-live')).toBe('assertive');
  });

  it('shows a grant-access state when the microphone is denied', () => {
    const hud = mountHud();
    hud.setMicPermission('denied');
    expect(query('.title').textContent).toBe('Microphone blocked');
    expect(query('.message').textContent).toBe('Grant microphone access');
  });
});

describe('interaction', () => {
  it('emits toggle, stop, retry and relisten events', () => {
    const events: string[] = [];
    const hud = mountHud({ onEvent: (event) => events.push(event.type) });
    const pill = query<HTMLButtonElement>('.pill');

    pill.click();
    expect(events).toEqual(['hud:toggle']);

    hud.setStatus('listening');
    pill.click();
    expect(events.at(-1)).toBe('hud:stop');

    hud.setStatus('clarifying');
    pill.click();
    expect(events.at(-1)).toBe('hud:relisten');

    hud.setStatus('error');
    pill.click();
    expect(events.at(-1)).toBe('hud:retry');
  });

  it('emits openSettings when the mic permission was denied', () => {
    const events: string[] = [];
    const hud = mountHud({ onEvent: (event) => events.push(event.type) });
    hud.setMicPermission('denied');
    query<HTMLButtonElement>('.pill').click();
    expect(events.at(-1)).toBe('hud:openSettings');
  });

  it('stops listening on Escape', () => {
    const events: string[] = [];
    const hud = mountHud({ onEvent: (event) => events.push(event.type) });
    hud.setStatus('listening');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events).toEqual(['hud:stop']);
  });

  it('shows a temporary hint', async () => {
    vi.useFakeTimers();
    const hud = mountHud();
    hud.showHint('Alt+V to talk', 1000);
    expect(query('.hintbox').dataset.visible).toBe('true');
    await vi.advanceTimersByTimeAsync(1000);
    expect(query('.hintbox').dataset.visible).toBe('false');
  });
});

describe('destroy', () => {
  it('removes the host, listeners and remount observer', async () => {
    const events: string[] = [];
    const hud = mountHud({ onEvent: (event) => events.push(event.type) });
    hud.setStatus('listening');
    hud.destroy();
    expect(document.querySelectorAll('vfe-hud')).toHaveLength(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events).toEqual([]);
    await Promise.resolve();
    expect(document.querySelectorAll('vfe-hud')).toHaveLength(0);
  });

  it('allows mounting again after destroy', () => {
    mountHud().destroy();
    const hud = mountHud();
    expect(document.querySelectorAll('vfe-hud')).toHaveLength(1);
    expect(hud.getStatus()).toBe('idle');
  });
});

describe('remount guard', () => {
  it('re-attaches a removed host at most three times per minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
    mountHud();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      document.querySelector('vfe-hud')?.remove();
      await Promise.resolve();
      await Promise.resolve();
      expect(document.querySelectorAll('vfe-hud')).toHaveLength(1);
    }
    document.querySelector('vfe-hud')?.remove();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelectorAll('vfe-hud')).toHaveLength(0);
  });
});

describe('collision heuristics', () => {
  const pill = { top: 700, bottom: 744, left: 400, right: 624, width: 224, height: 44 };
  const viewport = { width: 1024, height: 768 };

  it('keeps the default offset when nothing conflicts', () => {
    expect(bottomOffset({ pill, bottomBars: [], viewport })).toBe(24);
  });

  it('lifts above a full-width fixed bottom bar', () => {
    const bar = { top: 730, bottom: 768, left: 0, right: 1024, width: 1024, height: 38 };
    expect(bottomOffset({ pill, bottomBars: [bar], viewport })).toBe(96);
  });

  it('ignores a narrow bar', () => {
    const bar = { top: 730, bottom: 768, left: 0, right: 300, width: 300, height: 38 };
    expect(bottomOffset({ pill, bottomBars: [bar], viewport })).toBe(24);
  });

  it('adds a further offset when a focused control sits under the pill', () => {
    const focused = { top: 710, bottom: 750, left: 420, right: 600, width: 180, height: 40 };
    expect(bottomOffset({ pill, bottomBars: [], viewport, focused })).toBe(88);
  });
});
