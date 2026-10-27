import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Generate deterministic 16 kHz PCM16 WAV fixtures for Playwright's fake mic. */
const out = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'test', 'fixtures', 'audio');
mkdirSync(out, { recursive: true });

function wav(seconds, render) {
  const rate = 16_000;
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.max(-1, Math.min(1, render(i / rate, i)));
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const speech = (t) =>
  Math.sin(2 * Math.PI * 180 * t) * 0.6 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));

writeFileSync(join(out, 'speech-1.8s.wav'), wav(1.8, speech));
writeFileSync(
  join(out, 'two-utterances-2.4s.wav'),
  wav(2.4, (t) => (t > 0.9 && t < 1.3 ? 0 : speech(t))),
);
writeFileSync(join(out, 'burst-0.1s.wav'), wav(0.1, speech));
writeFileSync(
  join(out, 'silence-1s.wav'),
  wav(1, () => 0),
);
console.log('audio fixtures written');
