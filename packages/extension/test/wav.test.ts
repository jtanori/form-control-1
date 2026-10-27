import { describe, expect, it } from 'vitest';

import { encodeWavPcm16, rms, rmsDb, WAV_HEADER_BYTES } from '../src/audio/wav';

function ascii(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

describe('encodeWavPcm16', () => {
  it('writes a valid 16 kHz mono PCM16 header', () => {
    const wav = encodeWavPcm16(new Float32Array(1600), 16_000);
    const view = new DataView(wav);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 3200);
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(3200);
    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + 3200);
  });

  it('matches the reviewed byte snapshot', () => {
    const wav = encodeWavPcm16(Float32Array.from([0, 0.5, -0.5, 1, -1]), 16_000);
    const bytes = Array.from(new Uint8Array(wav));
    expect(bytes).toMatchSnapshot();
  });

  it('returns a header-only file for empty input', () => {
    const wav = encodeWavPcm16(new Float32Array(0));
    expect(wav.byteLength).toBe(44);
    const view = new DataView(wav);
    expect(view.getUint32(4, true)).toBe(36);
    expect(view.getUint32(40, true)).toBe(0);
  });

  it('handles odd sample counts and clamps out-of-range values', () => {
    const wav = encodeWavPcm16(Float32Array.from([2, -2, 0.25]));
    const view = new DataView(wav);
    expect(wav.byteLength).toBe(44 + 6);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(8192);
  });

  it('computes RMS and a floored dB value', () => {
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1);
    expect(rmsDb(new Float32Array([0, 0]))).toBe(-100);
    expect(rmsDb(new Float32Array([0.5, 0.5]))).toBeCloseTo(-6.02, 1);
  });
});
