import type { PageState } from '@vfe/protocol';
import { describe, expect, it, vi } from 'vitest';

import { SttError } from '../src/audio/stt';
import { runCommand } from '../src/background/pipeline';

const page: PageState = { urlOrAppTitle: 'Checkout', elements: [] };

const okResponse = {
  brainResponse: {
    thoughtProcess: 'fill',
    actions: [{ action: 'FILL' as const, targetId: 'vfe_1', value: 'Ada' }],
  },
  meta: { provider: 'openai', model: 'gpt-4o', latencyMs: 10, requestId: 'r1' },
};

describe('runCommand', () => {
  it('transcribes, then asks the brain with the captured page state', async () => {
    const brain = vi.fn(async () => okResponse);
    const transcribe = vi.fn(async () => ({ transcript: 'fill my name' }));
    const outcome = await runCommand(
      { transcribe: transcribe as never, brain },
      { audio: new ArrayBuffer(8), pageState: page, history: [] },
    );
    expect(outcome).toMatchObject({ ok: true, transcript: 'fill my name' });
    expect(brain.mock.calls[0]?.[0]).toMatchObject({
      transcript: 'fill my name',
      pageState: page,
      conversationHistory: [],
    });
  });

  it('maps an STT timeout to STT_TIMEOUT and never calls the brain', async () => {
    const brain = vi.fn();
    const outcome = await runCommand(
      {
        transcribe: (async () => {
          throw new SttError('TIMEOUT', 'timed out', true);
        }) as never,
        brain,
      },
      { audio: new ArrayBuffer(8), pageState: page, history: [] },
    );
    expect(outcome).toMatchObject({ ok: false, code: 'STT_TIMEOUT' });
    expect(brain).not.toHaveBeenCalled();
  });

  it('treats an empty transcript as NO_SPEECH', async () => {
    const outcome = await runCommand(
      { transcribe: (async () => ({ transcript: '   ' })) as never, brain: vi.fn() },
      { audio: new ArrayBuffer(8), pageState: page, history: [] },
    );
    expect(outcome).toMatchObject({ ok: false, code: 'NO_SPEECH' });
  });

  it('refuses to call the brain without a page state', async () => {
    const brain = vi.fn();
    const outcome = await runCommand(
      { transcribe: (async () => ({ transcript: 'fill' })) as never, brain },
      { audio: new ArrayBuffer(8), pageState: null, history: [] },
    );
    expect(outcome).toMatchObject({ ok: false, code: 'UNKNOWN' });
    expect(brain).not.toHaveBeenCalled();
  });

  it('maps a brain timeout to BRAIN_TIMEOUT', async () => {
    const { BrainError } = await import('../src/net/brain');
    const outcome = await runCommand(
      {
        transcribe: (async () => ({ transcript: 'fill' })) as never,
        brain: (async () => {
          throw new BrainError('TIMEOUT', 'slow');
        }) as never,
      },
      { audio: new ArrayBuffer(8), pageState: page, history: [] },
    );
    expect(outcome).toMatchObject({ ok: false, code: 'BRAIN_TIMEOUT' });
  });

  it('maps an invalid brain payload to INVALID_BRAIN_RESPONSE', async () => {
    const { BrainError } = await import('../src/net/brain');
    const outcome = await runCommand(
      {
        transcribe: (async () => ({ transcript: 'fill' })) as never,
        brain: (async () => {
          throw new BrainError('INVALID_RESPONSE', 'bad');
        }) as never,
      },
      { audio: new ArrayBuffer(8), pageState: page, history: [] },
    );
    expect(outcome).toMatchObject({ ok: false, code: 'INVALID_BRAIN_RESPONSE' });
  });
});
