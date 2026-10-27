import { describe, expect, it } from 'vitest';

import { PcmCollector } from '../src/audio/pcm';

describe('PcmCollector', () => {
  it('returns exactly the samples captured after a mark', () => {
    const collector = new PcmCollector(1000);
    collector.push(Float32Array.from([1, 2, 3]));
    const mark = collector.mark();
    collector.push(Float32Array.from([4, 5]));
    collector.push(Float32Array.from([6]));
    expect(Array.from(collector.since(mark))).toEqual([4, 5, 6]);
    expect(collector.length).toBe(6);
  });

  it('drops the oldest audio once the cap is reached', () => {
    const collector = new PcmCollector(4);
    collector.push(Float32Array.from([1, 2, 3]));
    const mark = collector.mark();
    collector.push(Float32Array.from([4, 5, 6]));
    expect(collector.length).toBeLessThanOrEqual(4);
    const tail = Array.from(collector.since(mark));
    expect(tail.at(-1)).toBe(6);
  });

  it('clears every chunk', () => {
    const collector = new PcmCollector(10);
    collector.push(Float32Array.from([1, 2]));
    collector.clear();
    expect(collector.length).toBe(0);
    expect(collector.since(0)).toHaveLength(0);
  });
});
