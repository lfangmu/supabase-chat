import { describe, it, expect, beforeEach } from 'vitest';
import {
  getClearedRooms,
  getClearedAt,
  setClearedAt,
  isHiddenByClear,
} from '@/utils/clearedRooms';

beforeEach(() => {
  localStorage.clear();
});

describe('clearedRooms util (微信式本机清空)', () => {
  it('returns {} when nothing stored', () => {
    expect(getClearedRooms()).toEqual({});
    expect(getClearedAt('g1')).toBeNull();
  });

  it('setClearedAt records the time and getClearedAt reads it back', () => {
    const iso = '2026-09-27T12:00:00.000Z';
    const map = setClearedAt('g1', iso);
    expect(map.g1).toBe(iso);
    expect(getClearedRooms().g1).toBe(iso);
    expect(getClearedAt('g1')).toBe(iso);
    // other rooms untouched
    expect(getClearedAt('g2')).toBeNull();
  });

  it('multiple rooms stored independently', () => {
    setClearedAt('a', '2026-01-01T00:00:00.000Z');
    setClearedAt('b', '2026-02-01T00:00:00.000Z');
    expect(Object.keys(getClearedRooms()).sort()).toEqual(['a', 'b']);
  });

  it('isHiddenByClear hides messages at/before the clear time', () => {
    const clearedAt = '2026-09-27T12:00:00.000Z';
    expect(isHiddenByClear('2026-09-27T11:59:59.000Z', clearedAt)).toBe(true);
    expect(isHiddenByClear('2026-09-27T12:00:00.000Z', clearedAt)).toBe(true);
    // strictly later message stays visible
    expect(isHiddenByClear('2026-09-27T12:00:01.000Z', clearedAt)).toBe(false);
    // no clear => never hidden
    expect(isHiddenByClear('2026-09-27T11:00:00.000Z', null)).toBe(false);
  });

  it('isHiddenByClear tolerates bad timestamps without throwing', () => {
    expect(isHiddenByClear('not-a-date', '2026-09-27T12:00:00.000Z')).toBe(false);
    expect(isHiddenByClear(undefined, '2026-09-27T12:00:00.000Z')).toBe(false);
  });
});
