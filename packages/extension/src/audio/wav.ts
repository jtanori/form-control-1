export const TARGET_SAMPLE_RATE = 16_000;
export const BYTES_PER_SAMPLE = 2;
export const WAV_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/**
 * Encode mono Float32 samples (-1…1) as a 16-bit PCM WAV.
 * Pure and allocation-honest so it can be snapshot-tested byte for byte.
 */
export function encodeWavPcm16(
  samples: Float32Array,
  sampleRate: number = TARGET_SAMPLE_RATE,
): ArrayBuffer {
  const dataSize = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(WAV_HEADER_BYTES + index * BYTES_PER_SAMPLE, Math.round(value), true);
  }
  return buffer;
}

/** Linear root-mean-square amplitude in [0, 1]. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/** RMS in dBFS, floored at -100 so logs stay finite. */
export function rmsDb(samples: Float32Array): number {
  const linear = rms(samples);
  if (linear <= 0) return -100;
  return Math.max(-100, 20 * Math.log10(linear));
}
