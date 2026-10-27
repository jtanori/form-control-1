import type { AgentStatus } from '@vfe/protocol';

import { bottomOffset, collectBottomBars, rectOf } from './collision';
import { COPY, type HudElements } from './templates';

export type HudEvent =
  | { type: 'hud:toggle' }
  | { type: 'hud:stop' }
  | { type: 'hud:retry' }
  | { type: 'hud:relisten' }
  | { type: 'hud:openSettings' };

export interface HudController {
  setStatus: (status: AgentStatus) => void;
  setTranscript: (partial: string) => void;
  setMessage: (text: string, kind?: 'info' | 'error') => void;
  setActionsProgress: (done: number, total: number) => void;
  setMicPermission: (state: 'unknown' | 'granted' | 'denied') => void;
  showHint: (text: string, ms?: number) => void;
  reposition: () => void;
  getStatus: () => AgentStatus;
  destroy: () => void;
}

export interface HudControllerOptions {
  elements: HudElements;
  host: HTMLElement;
  onEvent?: (event: HudEvent) => void;
  doc?: Document;
  now?: () => number;
}

const LIVE_COPY: Record<AgentStatus, string> = {
  idle: 'Ready. Press Alt+V to talk.',
  listening: 'Listening.',
  thinking: 'Mapping actions.',
  executing: 'Working.',
  clarifying: 'Clarification needed.',
  error: 'Something went wrong.',
};

export function createHudController(options: HudControllerOptions): HudController {
  const doc = options.doc ?? document;
  const { pill, title, transcript, message, live, progressBar, hintBox } = options.elements;
  const abort = new AbortController();
  let status: AgentStatus = 'idle';
  let transcriptText = '';
  let messageText = '';
  let progress = { done: 0, total: 0 };
  let micPermission: 'unknown' | 'granted' | 'denied' = 'unknown';
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const emit = (event: HudEvent): void => {
    options.onEvent?.(event);
  };

  const ariaLabel = (): string => {
    const base = `Voice form assistant: ${status}. Press Alt+V to talk.`;
    if (status === 'listening') return 'Voice form assistant: listening. Press Escape to stop.';
    if (status === 'error') return 'Voice form assistant: error. Press Retry to try again.';
    return base;
  };

  const executeCopy = (): string =>
    progress.total > 0
      ? `Filling ${Math.min(progress.done, progress.total)} of ${progress.total}…`
      : COPY.executing;

  const render = (): void => {
    pill.dataset.state = status;
    pill.setAttribute('aria-label', ariaLabel());
    live.setAttribute('aria-live', status === 'error' ? 'assertive' : 'polite');

    switch (status) {
      case 'idle':
        title.textContent = COPY.idle;
        break;
      case 'listening':
        title.textContent = COPY.listening;
        transcript.textContent = transcriptText;
        break;
      case 'thinking':
        title.textContent = COPY.thinking;
        break;
      case 'executing':
        title.textContent = executeCopy();
        break;
      case 'clarifying':
        title.textContent = COPY.clarifying;
        break;
      case 'error':
        title.textContent = micPermission === 'denied' ? 'Microphone blocked' : COPY.error;
        break;
    }

    message.textContent = messageText;
    transcript.textContent = status === 'listening' ? transcriptText : '';
    progressBar.style.width =
      progress.total > 0 ? `${Math.min(100, (progress.done / progress.total) * 100)}%` : '0%';
    live.textContent = messageText || LIVE_COPY[status];
  };

  const setStatus = (next: AgentStatus): void => {
    if (destroyed) return;
    status = next;
    if (next !== 'clarifying' && next !== 'error') messageText = '';
    if (next !== 'listening') transcript.textContent = '';
    render();
  };

  const setTranscript = (partial: string): void => {
    if (destroyed) return;
    transcriptText = partial.slice(0, 500);
    if (status === 'listening') render();
  };

  const setMessage = (text: string, kind: 'info' | 'error' = 'info'): void => {
    if (destroyed) return;
    messageText = text.slice(0, 500);
    if (kind === 'error') status = 'error';
    render();
  };

  const setActionsProgress = (done: number, total: number): void => {
    if (destroyed) return;
    progress = { done: Math.max(0, done), total: Math.max(0, total) };
    if (status === 'executing') render();
  };

  const setMicPermission = (state: 'unknown' | 'granted' | 'denied'): void => {
    if (destroyed) return;
    micPermission = state;
    if (state === 'denied') {
      status = 'error';
      messageText = 'Grant microphone access';
    }
    render();
  };

  const showHint = (text: string, ms = 4000): void => {
    if (destroyed) return;
    if (hintTimer) clearTimeout(hintTimer);
    hintBox.textContent = text;
    hintBox.dataset.visible = 'true';
    hintTimer = setTimeout(() => {
      hintTimer = null;
      hintBox.dataset.visible = 'false';
    }, ms);
  };

  const reposition = (): void => {
    if (destroyed) return;
    const rect = options.host.getBoundingClientRect();
    if (rect.width === 0) return;
    const active = doc.activeElement;
    const focused =
      active && active !== doc.body && 'getBoundingClientRect' in active
        ? rectOf(active.getBoundingClientRect())
        : null;
    const offset = bottomOffset({
      pill: rectOf(rect),
      focused,
      bottomBars: collectBottomBars(doc, doc.defaultView?.innerWidth ?? 1024),
      viewport: {
        width: doc.defaultView?.innerWidth ?? 1024,
        height: doc.defaultView?.innerHeight ?? 768,
      },
    });
    options.host.style.bottom = `${offset}px`;
  };

  const onClick = (): void => {
    if (destroyed) return;
    switch (status) {
      case 'listening':
        emit({ type: 'hud:stop' });
        break;
      case 'clarifying':
        emit({ type: 'hud:relisten' });
        break;
      case 'error':
        if (micPermission === 'denied') emit({ type: 'hud:openSettings' });
        else emit({ type: 'hud:retry' });
        break;
      default:
        emit({ type: 'hud:toggle' });
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (status !== 'listening') return;
    event.preventDefault();
    emit({ type: 'hud:stop' });
  };

  pill.addEventListener('click', onClick);
  doc.addEventListener('keydown', onKeyDown, { signal: abort.signal });
  render();

  return {
    setStatus,
    setTranscript,
    setMessage,
    setActionsProgress,
    setMicPermission,
    showHint,
    reposition,
    getStatus: () => status,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = null;
      options.host.remove();
    },
  };
}
