import { describe, it, expect } from 'vitest';
import { dropOldest, keepNewest } from '../src/shared/history';

const rec = (t: number) => ({ t });
const time = (r: { t: number }) => r.t;

describe('history limit', () => {
  it('keeps the newest N, newest first, without mutating the input', () => {
    const input = [rec(3), rec(1), rec(5), rec(2), rec(4)];
    expect(keepNewest(input, 3, time).map(time)).toEqual([5, 4, 3]);
    expect(input.map(time)).toEqual([3, 1, 5, 2, 4]);
  });

  it('adding a 16th record evicts exactly the oldest', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => rec(i + 1)); // 1..15
    const afterSave = keepNewest([rec(16), ...fifteen], 15, time);
    expect(afterSave).toHaveLength(15);
    expect(afterSave.map(time)).toEqual([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(dropOldest([rec(16), ...fifteen], 15, time).map(time)).toEqual([1]);
  });

  it('does nothing under the limit and trims an oversized legacy list', () => {
    expect(dropOldest([rec(1), rec(2)], 15, time)).toEqual([]);
    const legacy = Array.from({ length: 25 }, (_, i) => rec(i + 1));
    expect(keepNewest(legacy, 15, time)).toHaveLength(15);
    expect(dropOldest(legacy, 15, time).map(time)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
});
