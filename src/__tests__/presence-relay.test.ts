import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyRelayPresence,
  getGlobalPresence,
  getRoomPresence,
} from '@/lib/presenceRelay';

// 回归背景（2026-09-28 双账号线上回归）：
//
// 观察到「A 明明在线、且消息实时收发正常，B 的私聊头部却一直显示 A 离线」。
// 用独立旁观连接抓到的服务端全量 presence 里 A/B 都在，说明服务端没问题；
// 再以 A 的 guid 手动 join 一次全局频道（等于人为补一条 joins 增量），
// B 的界面**立刻**变回「在线」—— 证明 B 的增量通道是好的，只是当初那条
// join 增量在重连窗口里丢了，而客户端只在建连时做过一次全量同步。
//
// 修复：中继每 90s 重发一次自己的 presence track，让频道内其他成员收到
// `presence_diff(joins)` 从而把我们补回在线列表。下面这些用例锁住
// 「joins 增量必须能把漏掉的成员补回」这条修复路径。

const A = { id: 'user-a', nickname: 'wang' };
const B = { id: 'user-b', nickname: 'zhang' };

const ids = (list: { id?: string }[]) => list.map((m) => m.id).sort();

describe('presenceRelay 在线状态仓库', () => {
  beforeEach(() => {
    // 模块级仓库跨用例保留，逐个清空
    applyRelayPresence({ roomId: '__global__', event: 'sync', state: {} });
    applyRelayPresence({ roomId: 'default-room', event: 'sync', state: {} });
  });

  it('sync 用服务端全量状态覆盖本地', () => {
    applyRelayPresence({
      roomId: '__global__',
      event: 'sync',
      state: { 'user-user-a': { metas: [A] }, 'user-user-b': { metas: [B] } },
    });
    expect(ids(getGlobalPresence())).toEqual(['user-a', 'user-b']);
  });

  it('diff.joins 能把漏掉的成员补回在线列表（周期重同步的修复路径）', () => {
    // 建连时拿到的全量状态里只有自己：对端那条 join 增量在重连窗口里丢了
    applyRelayPresence({
      roomId: '__global__',
      event: 'sync',
      state: { 'user-user-b': { metas: [B] } },
    });
    expect(ids(getGlobalPresence())).toEqual(['user-b']);

    // 对端周期性重发 track -> 我们收到 joins 增量 -> 必须补回在线
    applyRelayPresence({
      roomId: '__global__',
      event: 'diff',
      joins: { 'user-user-a': { metas: [A] } },
      leaves: {},
    });
    expect(ids(getGlobalPresence())).toEqual(['user-a', 'user-b']);
  });

  it('diff.leaves 把成员移出在线列表', () => {
    applyRelayPresence({
      roomId: '__global__',
      event: 'sync',
      state: { 'user-user-a': { metas: [A] }, 'user-user-b': { metas: [B] } },
    });
    applyRelayPresence({
      roomId: '__global__',
      event: 'diff',
      joins: {},
      leaves: { 'user-user-a': { metas: [A] } },
    });
    expect(ids(getGlobalPresence())).toEqual(['user-b']);
  });

  it('同一 key 重新 track（joins 新 ref + leaves 旧 ref）不得把成员抹成离线', () => {
    // 真正的根因：周期性 presenceResync 会发这种「自相矛盾」的 diff ——
    // 同一个 key 同时出现在 joins(新 phx_ref) 与 leaves(旧 phx_ref)。
    // 若按「leaves 整键删除」处理，每 90s 就把在线的人抹掉一次。
    applyRelayPresence({
      roomId: '__global__',
      event: 'sync',
      state: {
        'user-user-a': { metas: [{ ...A, phx_ref: 'ref-old' }] },
        'user-user-b': { metas: [{ ...B, phx_ref: 'ref-b' }] },
      },
    });
    expect(ids(getGlobalPresence())).toEqual(['user-a', 'user-b']);

    applyRelayPresence({
      roomId: '__global__',
      event: 'diff',
      joins: {
        'user-user-a': { metas: [{ ...A, phx_ref: 'ref-new', phx_ref_prev: 'ref-old' }] },
      },
      leaves: { 'user-user-a': { metas: [{ ...A, phx_ref: 'ref-old' }] } },
    });
    expect(ids(getGlobalPresence())).toEqual(['user-a', 'user-b']);
  });

  it('多标签页：同 key 仍有其它 ref 时，leaves 只移除对应 ref', () => {
    applyRelayPresence({
      roomId: '__global__',
      event: 'sync',
      state: {
        'user-user-a': { metas: [{ ...A, phx_ref: 'ref-1' }, { ...A, phx_ref: 'ref-2' }] },
      },
    });
    applyRelayPresence({
      roomId: '__global__',
      event: 'diff',
      joins: {},
      leaves: { 'user-user-a': { metas: [{ ...A, phx_ref: 'ref-1' }] } },
    });
    expect(ids(getGlobalPresence())).toEqual(['user-a']);
  });

  it('同一 key 全部 ref 都被移除后才算离线', () => {
    applyRelayPresence({
      roomId: '__global__',
      event: 'sync',
      state: {
        'user-user-a': { metas: [{ ...A, phx_ref: 'ref-1' }, { ...A, phx_ref: 'ref-2' }] },
      },
    });
    applyRelayPresence({
      roomId: '__global__',
      event: 'diff',
      joins: {},
      leaves: {
        'user-user-a': {
          metas: [{ ...A, phx_ref: 'ref-1' }, { ...A, phx_ref: 'ref-2' }],
        },
      },
    });
    expect(getGlobalPresence()).toEqual([]);
  });

  it('兼容 metas 直接是数组的形状', () => {
    applyRelayPresence({ roomId: '__global__', event: 'sync', state: { k: [A] } });
    expect(ids(getGlobalPresence())).toEqual(['user-a']);
  });

  it('同一 key 有多条 meta 时取最后一条', () => {
    applyRelayPresence({
      roomId: '__global__',
      event: 'sync',
      state: { k: { metas: [{ id: 'old' }, { id: 'new' }] } },
    });
    expect(ids(getGlobalPresence())).toEqual(['new']);
  });

  it('房间 presence 与全局 presence 互不干扰', () => {
    applyRelayPresence({ roomId: '__global__', event: 'sync', state: { k: { metas: [A] } } });
    applyRelayPresence({ roomId: 'default-room', event: 'sync', state: { k: { metas: [B] } } });
    expect(ids(getGlobalPresence())).toEqual(['user-a']);
    expect(ids(getRoomPresence('default-room'))).toEqual(['user-b']);
  });

  it('缺少 roomId 的事件被忽略（不写入任何仓库）', () => {
    applyRelayPresence({ event: 'sync', state: { k: { metas: [A] } } });
    expect(getGlobalPresence()).toEqual([]);
  });
});
