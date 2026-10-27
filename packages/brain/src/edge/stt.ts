import type { EdgeConfig } from './config';

export interface SttInput {
  audio: ArrayBuffer;
  mimeType: string;
  filename: string;
  language?: string;
}

export interface SttResult {
  transcript: string;
  confidence?: number;
  durationMs: number;
}

export class SttError extends Error {
  readonly code: 'UPSTREAM_ERROR' | 'UPSTREAM_TIMEOUT' | 'NOT_CONFIGURED';

  constructor(code: 'UPSTREAM_ERROR' | 'UPSTREAM_TIMEOUT' | 'NOT_CONFIGURED', message: string) {
    super(message);
    this.name = 'SttError';
    this.code = code;
  }
}

/**
 * Read the duration of a PCM WAV file from its RIFF header. D-2 always uploads
 * 16 kHz mono WAV, so this is authoritative without decoding audio.
 */
export function wavDurationMs(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  );
  if (riff !== 'RIFF' || wave !== 'WAVE') return null;

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 8 + 12 <= view.byteLength) {
      byteRate = view.getUint32(offset + 16, true);
    }
    if (id === 'data') {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (byteRate <= 0 || dataSize <= 0) return null;
  return Math.round((dataSize / byteRate) * 1000);
}

export interface SttDeps {
  config: EdgeConfig;
  fetcher: typeof fetch;
  timeoutMs?: number;
}

export async function transcribe(input: SttInput, deps: SttDeps): Promise<SttResult> {
  if (deps.config.mockStt) {
    return {
      transcript: 'This is a mock transcript.',
      durationMs: wavDurationMs(input.audio) ?? 0,
    };
  }
  if (!deps.config.sttApiKey) throw new SttError('NOT_CONFIGURED', 'STT provider key is missing');

  const timeoutMs = deps.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (deps.config.STT_PROVIDER === 'groq') {
      const form = new FormData();
      form.append('file', new Blob([input.audio], { type: input.mimeType }), input.filename);
      form.append('model', 'whisper-large-v3-turbo');
      form.append('response_format', 'verbose_json');
      if (input.language) form.append('language', input.language);
      const response = await deps.fetcher('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${deps.config.sttApiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SttError('UPSTREAM_ERROR', `Groq returned HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { text?: string; duration?: number };
      return {
        transcript: payload.text ?? '',
        durationMs: Math.round((payload.duration ?? 0) * 1000),
      };
    }

    const response = await deps.fetcher(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
      {
        method: 'POST',
        headers: {
          authorization: `Token ${deps.config.sttApiKey}`,
          'content-type': input.mimeType,
        },
        body: input.audio,
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new SttError('UPSTREAM_ERROR', `Deepgram returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{ transcript?: string; confidence?: number }>;
        }>;
      };
    };
    const alternative = payload.results?.channels?.[0]?.alternatives?.[0];
    return {
      transcript: alternative?.transcript ?? '',
      confidence: alternative?.confidence,
      durationMs: wavDurationMs(input.audio) ?? 0,
    };
  } catch (error) {
    if (error instanceof SttError) throw error;
    const message = error instanceof Error ? error.message : 'STT provider failed';
    throw new SttError(
      /abort|timeout/i.test(message) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
      message,
    );
  } finally {
    clearTimeout(timer);
  }
}
