import { describe, it, expect, vi } from 'vitest';
import {
  acquireSSESlots,
  releaseSSESlot,
  renewSSESlot,
  SSE_MAX_PER_USER,
  SSE_MAX_PER_IP,
  SSE_SLOT_TTL_MS,
} from '@/lib/sse-concurrency';

// 注意：模块内租约表是进程级单例 Map，跨测试共享。
// 每个用例都用唯一 userId/ip，TTL 用例自带 fake timers，保证互不干扰、可重复。

describe('sse-concurrency (P1-2)', () => {
  it('allows up to SSE_MAX_PER_USER concurrent SSE for the same user, rejects the next', () => {
    const userId = 'user-cap';
    const ip = '203.0.113.1';
    const ids: string[] = [];
    try {
      for (let i = 0; i < SSE_MAX_PER_USER; i++) {
        const r = acquireSSESlots(userId, ip);
        expect(r.allowed).toBe(true);
        ids.push(r.connId!);
      }
      const over = acquireSSESlots(userId, ip);
      expect(over.allowed).toBe(false);
      expect(over.exceeded?.kind).toBe('user');
      expect(over.exceeded?.limit).toBe(SSE_MAX_PER_USER);
      expect(over.connId).toBeUndefined();
    } finally {
      for (const id of ids) releaseSSESlot(id, userId, ip);
    }
  });

  it('releasing a lease restores capacity', () => {
    const userId = 'user-release';
    const ip = '203.0.113.2';
    const a = acquireSSESlots(userId, ip);
    const b = acquireSSESlots(userId, ip);
    expect(a.allowed && b.allowed).toBe(true);
    releaseSSESlot(a.connId, userId, ip);
    releaseSSESlot(b.connId, userId, ip);
    const c = acquireSSESlots(userId, ip);
    expect(c.allowed).toBe(true);
    releaseSSESlot(c.connId, userId, ip);
  });

  it('enforces a separate per-IP cap', () => {
    const ip = '198.51.100.7';
    const ids: Array<{ id: string; user: string }> = [];
    try {
      for (let i = 0; i < SSE_MAX_PER_IP; i++) {
        const u = `ip-user-${i}`;
        const r = acquireSSESlots(u, ip);
        expect(r.allowed).toBe(true);
        ids.push({ id: r.connId!, user: u });
      }
      const over = acquireSSESlots('ip-user-over', ip);
      expect(over.allowed).toBe(false);
      expect(over.exceeded?.kind).toBe('ip');
    } finally {
      for (const e of ids) releaseSSESlot(e.id, e.user, ip);
    }
  });

  it("skips the IP cap when IP is 'unknown' (e.g. local dev without CF header)", () => {
    const ids: Array<{ id: string; user: string }> = [];
    try {
      for (let i = 0; i < SSE_MAX_PER_IP + 2; i++) {
        const u = `unk-${i}`;
        const r = acquireSSESlots(u, 'unknown');
        expect(r.allowed).toBe(true);
        ids.push({ id: r.connId!, user: u });
      }
    } finally {
      for (const e of ids) releaseSSESlot(e.id, e.user, 'unknown');
    }
  });

  it('releaseSSESlot is idempotent (no negative counts / no throw)', () => {
    const userId = 'user-idempotent';
    const ip = '192.0.2.5';
    const r = acquireSSESlots(userId, ip);
    expect(r.allowed).toBe(true);
    expect(() => {
      releaseSSESlot(r.connId, userId, ip);
      releaseSSESlot(r.connId, userId, ip);
      releaseSSESlot(r.connId, userId, ip);
    }).not.toThrow();
  });

  // ---- 线上事故回归：槽位必须在「没有断开回调」的情况下也能自愈 ----
  it('unrenewed leases expire, so a dead connection self-heals (no permanent 429)', () => {
    vi.useFakeTimers();
    try {
      const userId = 'user-ttl';
      const ip = '203.0.113.9';
      const ids: string[] = [];
      for (let i = 0; i < SSE_MAX_PER_USER; i++) {
        const r = acquireSSESlots(userId, ip);
        expect(r.allowed).toBe(true);
        ids.push(r.connId!);
      }
      // 占满
      expect(acquireSSESlots(userId, ip).allowed).toBe(false);
      // 模拟「连接已死且平台不上报断开」：不再续租，时间走过 TTL
      vi.advanceTimersByTime(SSE_SLOT_TTL_MS + 1000);
      // 关键断言：必须能重新连上（否则用户被永久挡在门外）
      const healed = acquireSSESlots(userId, ip);
      expect(healed.allowed).toBe(true);
      releaseSSESlot(healed.connId, userId, ip);
      for (const id of ids) releaseSSESlot(id, userId, ip);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renewing keeps live connections from being reaped', () => {
    vi.useFakeTimers();
    try {
      const userId = 'user-renew';
      const ip = '203.0.113.10';
      const ids: string[] = [];
      for (let i = 0; i < SSE_MAX_PER_USER; i++) {
        const r = acquireSSESlots(userId, ip);
        expect(r.allowed).toBe(true);
        ids.push(r.connId!);
      }
      // 模拟「客户端一直在消费」：每个周期都续租，累计走过 3 倍 TTL
      for (let t = 0; t < 6; t++) {
        vi.advanceTimersByTime(SSE_SLOT_TTL_MS / 2);
        for (const id of ids) renewSSESlot(id, userId, ip);
      }
      // 关键断言：活连接不该被回收，仍然占满（新连接被拒）
      expect(acquireSSESlots(userId, ip).allowed).toBe(false);
      for (const id of ids) releaseSSESlot(id, userId, ip);
    } finally {
      vi.useRealTimers();
    }
  });
});
