import { micIcon } from './icons';

export interface HudElements {
  pill: HTMLButtonElement;
  icon: HTMLSpanElement;
  title: HTMLSpanElement;
  transcript: HTMLSpanElement;
  message: HTMLSpanElement;
  live: HTMLSpanElement;
  progress: HTMLSpanElement;
  progressBar: HTMLSpanElement;
  wave: HTMLSpanElement;
  spinner: HTMLSpanElement;
  hint: HTMLSpanElement;
  hintBox: HTMLSpanElement;
}

/** All copy lives here for a future i18n pass. */
export const COPY = {
  idle: 'Ready',
  listening: 'Listening…',
  thinking: 'Mapping actions…',
  executing: 'Working…',
  clarifying: 'Clarification needed',
  error: 'Something went wrong',
  hint: 'Alt+V',
} as const;

function span(className: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  return element;
}

/** Built with DOM APIs only: untrusted text is always assigned via textContent. */
export function createHudDom(): HudElements {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'pill';
  pill.dataset.state = 'idle';

  const icon = span('icon');
  icon.append(micIcon());

  const wave = span('wave');
  for (let index = 0; index < 5; index += 1) wave.append(span('bar'));
  const spinner = span('spinner');

  const title = span('title');
  title.textContent = COPY.idle;
  const transcript = span('transcript');
  transcript.setAttribute('aria-hidden', 'true');
  const message = span('message');
  const progress = span('progress');
  const progressBar = span('bar');
  progress.append(progressBar);
  const live = span('live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  const body = span('body');
  body.append(title, transcript, message, progress);

  const hint = span('hint');
  hint.textContent = COPY.hint;

  pill.append(icon, spinner, wave, body, hint);

  const hintBox = span('hintbox');
  hintBox.dataset.visible = 'false';

  const wrap = span('wrap');
  wrap.append(pill, hintBox, live);

  return {
    pill,
    icon,
    title,
    transcript,
    message,
    live,
    progress,
    progressBar,
    wave,
    spinner,
    hint,
    hintBox,
  };
}
