import { describe, expect, it } from 'vitest';

import { resampleLinear, resampleTo16k } from '../src/audio/resample';

function sine(sampleRate: number, seconds: number, frequency = 440): Float32Array {
  const length = Math.round(sampleRate * seconds);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.5;
  }
  return samples;
}

describe('resampleLinear', () => {
  it('converts 44.1 kHz audio to 16 kHz with the right length and no NaN', () => {
    const input = sine(44_100, 0.25);
    const output = resampleLinear(input, 44_100, 16_000);
    expect(output.length).toBe(Math.round((input.length * 16_000) / 44_100));
    expect(output.some(Number.isNaN)).toBe(false);
    expect(Math.max(...output.map(Math.abs))).toBeGreaterThan(0.1);
  });

  it('returns a copy when the rate already matches', () => {
    const input = sine(16_000, 0.01);
    const output = resampleLinear(input, 16_000, 16_000);
    expect(output).not.toBe(input);
    expect(Array.from(output)).toEqual(Array.from(input));
  });

  it('rejects invalid sample rates', () => {
    expect(() => resampleLinear(new Float32Array(10), 0, 16_000)).toThrow();
  });

  it('resampleTo16k falls back to the pure resampler without an offline context', async () => {
    const output = await resampleTo16k(sine(48_000, 0.1), 48_000);
    expect(output.length).toBe(1600);
    expect(output.some(Number.isNaN)).toBe(false);
  });
});
