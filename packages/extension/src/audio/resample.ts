import { TARGET_SAMPLE_RATE } from './wav';

/**
 * Linear-interpolation resampler. Deterministic and dependency-free; used when
 * the device ignores the requested 16 kHz capture rate.
 */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate <= 0 || toRate <= 0) throw new Error('Sample rates must be positive');
  if (fromRate === toRate) return samples.slice();
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const fraction = position - leftIndex;
    const left = samples[leftIndex] ?? 0;
    const right = samples[rightIndex] ?? left;
    output[index] = left + (right - left) * fraction;
  }
  return output;
}

/** Resample to the 16 kHz rate Whisper expects, using an offline context when present. */
export async function resampleTo16k(
  samples: Float32Array,
  fromRate: number,
): Promise<Float32Array> {
  if (fromRate === TARGET_SAMPLE_RATE) return samples;
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
    .OfflineAudioContext;
  if (Offline) {
    try {
      const length = Math.max(1, Math.ceil((samples.length * TARGET_SAMPLE_RATE) / fromRate));
      const context = new Offline(1, length, TARGET_SAMPLE_RATE);
      const buffer = context.createBuffer(1, samples.length, fromRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
      const rendered = await context.startRendering();
      return rendered.getChannelData(0);
    } catch {
      // Fall through to the pure resampler.
    }
  }
  return resampleLinear(samples, fromRate, TARGET_SAMPLE_RATE);
}
