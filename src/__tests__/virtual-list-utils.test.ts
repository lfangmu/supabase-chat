import { describe, it, expect } from 'vitest';
import {
  buildVirtualList,
  estimateItemSize,
  findMessageIndexInVirtualList,
  resolveShowScrollBtn,
  computePrependScrollTop,
  pinnedScrollTop,
  isPrependGrowth,
  PINNED_THRESHOLD,
  SCROLL_BTN_SHOW_THRESHOLD,
  SCROLL_BTN_HIDE_THRESHOLD,
} from '@/utils/virtual-list-utils';
import { Message, VirtualListItem } from '@/types';
import { at } from '@/test-utils/at';

/** Create a test message */
function createMessage(id: string, timestamp: string, type: Message['type'] = 'text'): Message {
  return {
    id,
    user: 'testuser',
    type,
    content: `message ${id}`,
    timestamp,
  };
}

describe('virtual-list-utils', () => {
  describe('buildVirtualList', () => {
    it('should return empty array for empty messages', () => {
      expect(buildVirtualList([])).toEqual([]);
    });

    it('should insert a separator before the first message', () => {
      const messages = [createMessage('1', '2025-06-23T10:00:00.000Z')];
      const items = buildVirtualList(messages);
      expect(items).toHaveLength(2);
      expect(at(items, 0).type).toBe('separator');
      expect(at(items, 1).type).toBe('message');
    });

    it('should insert separators between messages on different days', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-23T14:00:00.000Z'),
        createMessage('3', '2025-06-24T10:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      // Expect: sep, msg1, msg2, sep, msg3 = 5 items
      expect(items).toHaveLength(5);
      expect(at(items, 0).type).toBe('separator');
      expect(at(items, 1).type).toBe('message');
      expect(at(items, 2).type).toBe('message');
      expect(at(items, 3).type).toBe('separator');
      expect(at(items, 4).type).toBe('message');
    });

    it('should not insert separator between messages on the same day', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-23T14:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      // Expect: sep, msg1, msg2 = 3 items
      expect(items).toHaveLength(3);
    });

    it('should set correct originalIndex for message items', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-24T10:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      const msgItems = items.filter((i) => i.type === 'message') as Extract<
        VirtualListItem,
        { type: 'message' }
      >[];
      expect(at(msgItems, 0).originalIndex).toBe(0);
      expect(at(msgItems, 1).originalIndex).toBe(1);
    });

    it('should use unique keys for separators and messages', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-24T10:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      const keys = items.map((i) => i.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    // 回归：无效时间戳（历史上 realtime 负载丢失 timestamp）不得产生
    // 「NaN年NaN月NaN日 undefined」分隔线，也不得产生 key 含 NaN 的项。
    it('should not produce a separator for an invalid timestamp', () => {
      const messages = [createMessage('1', 'invalid')];
      const items = buildVirtualList(messages);
      // 只有消息项，没有分隔线
      expect(items).toHaveLength(1);
      expect(at(items, 0).type).toBe('message');

      const labels = items.map((i) => (i.type === 'separator' ? i.date : ''));
      expect(labels.join('|')).not.toContain('NaN');
      expect(items.map((i) => i.key).join('|')).not.toContain('NaN');
    });

    it('should still insert a valid separator after an invalid-timestamp message', () => {
      const messages = [
        createMessage('1', 'invalid'),
        createMessage('2', '2025-06-24T10:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      const separators = items.filter((i) => i.type === 'separator');
      expect(separators).toHaveLength(1);
      expect((separators[0] as Extract<VirtualListItem, { type: 'separator' }>).date).not.toContain(
        'NaN'
      );
    });
  });

  describe('estimateItemSize', () => {
    it('should return 40 for separators', () => {
      const items = buildVirtualList([createMessage('1', '2025-06-23T10:00:00.000Z')]);
      const separator = at(items, 0);
      expect(estimateItemSize(separator)).toBe(40);
    });

    it('should return 260 for image messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'image');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(260);
    });

    it('should return 300 for video messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'video');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(300);
    });

    it('should return 80 for voice messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'voice');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(80);
    });

    it('should return 72 for file messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'file');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(72);
    });

    it('should return 72 for text messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'text');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(72);
    });
  });

  describe('findMessageIndexInVirtualList', () => {
    it('should find the virtual list index of a message by ID', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-24T10:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      // Virtual list: [sep, msg1, sep, msg2] → indices [0, 1, 2, 3]
      expect(findMessageIndexInVirtualList(items, '1')).toBe(1);
      expect(findMessageIndexInVirtualList(items, '2')).toBe(3);
    });

    it('should return -1 if message not found', () => {
      const messages = [createMessage('1', '2025-06-23T10:00:00.000Z')];
      const items = buildVirtualList(messages);
      expect(findMessageIndexInVirtualList(items, 'nonexistent')).toBe(-1);
    });

    it('should return -1 for empty virtual list', () => {
      expect(findMessageIndexInVirtualList([], 'any')).toBe(-1);
    });
  });

  // 回归：「消息列表上下来回弹」——单阈值会让「回到最新」气泡在阈值附近反复闪现。
  describe('resolveShowScrollBtn（滞回）', () => {
    it('两个阈值必须满足 hide < show，否则滞回区间为空', () => {
      expect(SCROLL_BTN_HIDE_THRESHOLD).toBeLessThan(SCROLL_BTN_SHOW_THRESHOLD);
    });

    it('未显示时，距底 120~240px 之间的抖动不得让按钮闪出来', () => {
      // 依次模拟：121 → 130 → 200 → 239（全部落在死区），应始终保持隐藏
      for (const d of [121, 130, 200, 239]) {
        expect(resolveShowScrollBtn(d, false)).toBe(false);
      }
    });

    it('未显示时，只有超过 240px 才显示', () => {
      expect(resolveShowScrollBtn(240, false)).toBe(false);
      expect(resolveShowScrollBtn(241, false)).toBe(true);
    });

    it('已显示时，回到 120px 以内才隐藏，中间死区保持显示', () => {
      // 已显示 → 从 500 逐步回到 130，仍在死区，应保持显示
      for (const d of [500, 300, 241, 200, 130]) {
        expect(resolveShowScrollBtn(d, true)).toBe(true);
      }
      expect(resolveShowScrollBtn(120, true)).toBe(false);
      expect(resolveShowScrollBtn(0, true)).toBe(false);
    });

    it('阈值附近的往复抖动不应改变状态（无抖动输出）', () => {
      // 用户停在 ~125px 处，内容高度在 ±28px 间波动（输入中指示器出现/消失）
      const samples = [125, 153, 125, 97, 125, 153, 97, 125];
      let shown = false; // 初始贴近底部 → 未显示
      const states = samples.map((d) => {
        shown = resolveShowScrollBtn(d, shown);
        return shown;
      });
      // 全程都不该显示（最大值 153 < 240，且从未进入「已显示」态）
      expect(states.every((s) => s === false)).toBe(true);
    });

    it('一旦真正上滑离开，状态应稳定为显示且不再跳回', () => {
      let shown = false;
      shown = resolveShowScrollBtn(900, shown);
      expect(shown).toBe(true);
      // 回落到死区，仍显示
      shown = resolveShowScrollBtn(200, shown);
      expect(shown).toBe(true);
    });
  });

  describe('computePrependScrollTop（顶部插入历史锚定）', () => {
    it('插入后 scrollTop 应增加与新增高度相同的量，使视口内容不动', () => {
      // 实测：插入前 sh=3029 st=0，插入后 sh=4411（新增 1382）
      expect(computePrependScrollTop(0, 3029, 4411)).toBe(1382);
    });

    it('高度未变化时应保持原 scrollTop', () => {
      expect(computePrependScrollTop(500, 3000, 3000)).toBe(500);
    });

    it('连续两次插入应累加（第二次基于更新后的锚点）', () => {
      const first = computePrependScrollTop(0, 1000, 1600); // 600
      expect(first).toBe(600);
      const second = computePrependScrollTop(first, 1600, 2400); // +800
      expect(second).toBe(1400);
    });
  });

  describe('isPrependGrowth（区分顶部插入历史与底部追加新消息）', () => {
    it('末项 key 不变而长度变大 → 顶部插入历史', () => {
      expect(isPrependGrowth(30, 16, 'msg-last', 'msg-last')).toBe(true);
    });

    it('末项 key 变了 → 底部追加新消息，不是 prepend', () => {
      expect(isPrependGrowth(17, 16, 'msg-new', 'msg-last')).toBe(false);
    });

    it('长度没变大（纯编辑/删除）→ 不是 prepend', () => {
      expect(isPrependGrowth(16, 16, 'msg-last', 'msg-last')).toBe(false);
      expect(isPrependGrowth(15, 16, 'msg-other', 'msg-last')).toBe(false);
    });

    it('首次渲染缺少历史基线 → 不算 prepend，避免误判跳过自动滚动', () => {
      expect(isPrependGrowth(16, 0, 'msg-last', null)).toBe(false);
      expect(isPrependGrowth(16, 0, null, 'msg-last')).toBe(false);
      expect(isPrependGrowth(16, 0, null, null)).toBe(false);
    });
  });

  describe('pinnedScrollTop（贴底跟随）', () => {
    it('应返回内容末端偏移 = scrollHeight - clientHeight', () => {
      expect(pinnedScrollTop(2769, 700)).toBe(2069);
    });

    it('内容变高后应跟到新的末端（新消息保持可见）', () => {
      // 输入中指示器 +28：末端从 2069 跟到 2097
      expect(pinnedScrollTop(2797, 700)).toBe(2097);
    });

    it('内容变矮后应停在新末端，不得「多减一次」把视口顶上去', () => {
      // 关键回归：若改用「scrollTop += 高度差」的增量法，内容变矮时浏览器已先
      // 钳制过一次，再叠加负增量就会多减 28px。对齐法必须仍停在新末端。
      expect(pinnedScrollTop(2769, 700)).toBe(2069);
    });

    it('内容比视口还短时应钳制为 0，不得返回负数', () => {
      expect(pinnedScrollTop(400, 750)).toBe(0);
      expect(pinnedScrollTop(0, 750)).toBe(0);
    });

    it('贴底阈值必须比自动滚动阈值更紧，避免上滑阅读时被拽下去', () => {
      expect(PINNED_THRESHOLD).toBeLessThan(120);
      expect(PINNED_THRESHOLD).toBeGreaterThan(0);
    });
  });
});
