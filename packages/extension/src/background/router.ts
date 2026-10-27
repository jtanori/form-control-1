import {
  contentMayReceive,
  hasAudioPayload,
  isTrustedSender,
  parseAudioCommand,
  parseAudioEvent,
  type AudioCommand,
  type AudioEvent,
  type ParseFailure,
  type RuntimeSender,
  type SpeechEndEvent,
} from '../messaging';

import type { OffscreenManager } from './offscreen-manager';

export interface RouterDeps {
  runtimeId: string;
  manager: OffscreenManager;
  sendToOffscreen: (command: AudioCommand) => Promise<void>;
  broadcast: (event: AudioEvent) => Promise<void> | void;
  /** D-2 consumes the utterance; D-1 deliberately drops it. */
  onSpeechEnd?: (event: SpeechEndEvent) => Promise<void> | void;
}

export interface RouterResult {
  ok: boolean;
  error?: string;
}

export interface MessageRouter {
  handleMessage: (message: unknown, sender: RuntimeSender | undefined) => Promise<RouterResult>;
  toggle: () => Promise<RouterResult>;
  isListening: () => boolean;
  isMuted: () => boolean;
}

export function createMessageRouter(deps: RouterDeps): MessageRouter {
  let listening = false;
  let mutedForTts = false;

  const state = (): AudioEvent => ({ type: 'LISTENING_STATE', listening, mutedForTts });

  const start = async (): Promise<RouterResult> => {
    try {
      await deps.manager.ensure();
    } catch {
      return { ok: false, error: 'OFFSCREEN_FAILED' };
    }
    await deps.sendToOffscreen({ type: 'AUDIO_START' });
    listening = true;
    mutedForTts = false;
    await deps.broadcast(state());
    return { ok: true };
  };

  const stop = async (): Promise<RouterResult> => {
    await deps.sendToOffscreen({ type: 'AUDIO_STOP' });
    listening = false;
    mutedForTts = false;
    await deps.broadcast(state());
    deps.manager.scheduleIdleClose();
    return { ok: true };
  };

  const fail = (error: string): RouterResult => ({ ok: false, error });

  const handleCommand = async (command: AudioCommand): Promise<RouterResult> => {
    switch (command.type) {
      case 'AUDIO_START':
        return start();
      case 'AUDIO_STOP':
        return stop();
      case 'AUDIO_MUTE':
        mutedForTts = true;
        await deps.sendToOffscreen(command);
        await deps.broadcast(state());
        return { ok: true };
      case 'AUDIO_UNMUTE':
        mutedForTts = false;
        await deps.sendToOffscreen(command);
        await deps.broadcast(state());
        return { ok: true };
      default:
        return fail('UNKNOWN_MESSAGE');
    }
  };

  const handleEvent = async (
    event: AudioEvent,
    sender: RuntimeSender | undefined,
  ): Promise<RouterResult> => {
    // A content script must never see an utterance buffer.
    if (hasAudioPayload(event) && sender?.tab?.id !== undefined) {
      return fail('AUDIO_IN_CONTENT_PATH');
    }
    if (event.type === 'VAD_SPEECH_END') {
      await deps.onSpeechEnd?.(event);
      return { ok: true };
    }
    if (event.type === 'LISTENING_STATE') {
      listening = event.listening;
      mutedForTts = event.mutedForTts;
    }
    if (event.type === 'AUDIO_ERROR') {
      listening = false;
    }
    if (contentMayReceive(event)) await deps.broadcast(event);
    return { ok: true };
  };

  return {
    async handleMessage(message, sender) {
      if (!isTrustedSender(sender, deps.runtimeId)) return fail('UNTRUSTED_SENDER');

      const command = parseAudioCommand(message);
      if (command.ok) return handleCommand(command.value);

      const event = parseAudioEvent(message);
      if (event.ok) return handleEvent(event.value, sender);

      const reason: ParseFailure = { ok: false, error: 'UNKNOWN_MESSAGE' };
      return reason;
    },
    async toggle() {
      return listening ? stop() : start();
    },
    isListening: () => listening,
    isMuted: () => mutedForTts,
  };
}
