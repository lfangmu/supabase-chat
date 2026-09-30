/**
 * Virtual list utility functions for REQ-005 (message date separators)
 *
 * Builds a mixed VirtualListItem[] array from Message[] with date separators
 * inserted when adjacent messages span different days.
 */

import { Message, VirtualListItem } from '@/types';
import { getDateKey, formatDateSeparatorFromTimestamp } from './date-utils';

/**
 * Build a virtual list with date separators interleaved between messages.
 * A separator is inserted before a message if its date differs from the previous message.
 */
export function buildVirtualList(messages: Message[]): VirtualListItem[] {
  const items: VirtualListItem[] = [];
  let lastDateKey = '';

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    // noUncheckedIndexedAccess：稀疏数组下取到的可能是 undefined，跳过而不是崩在下面
    if (!message) continue;
    const dateKey = getDateKey(message.timestamp);

    // Insert separator if date changed from previous message.
    // dateKey 为空串表示无效时间戳（见 getDateKey）→ 跳过分隔线，避免渲染出「NaN年NaN月NaN日」。
    if (dateKey && dateKey !== lastDateKey) {
      items.push({
        type: 'separator',
        date: formatDateSeparatorFromTimestamp(message.timestamp),
        key: `sep-${dateKey}`,
      });
      lastDateKey = dateKey;
    }

    items.push({
      type: 'message',
      message,
      originalIndex: i,
      key: `msg-${message.id}`,
    });
  }

  return items;
}

/**
 * Estimate the size of a virtual list item.
 * Separators are 40px. Messages vary by type.
 */
export function estimateItemSize(item: VirtualListItem): number {
  if (item.type === 'separator') {
    return 40;
  }

  const message = item.message;
  switch (message.type) {
    case 'image':
      return 260;
    case 'video':
      return 300;
    case 'voice':
      return 80;
    case 'file':
      return 72;
    default:
      return 72; // text
  }
}

/**
 * Find the virtual list index of a message by its ID.
 * Returns -1 if not found.
 */
export function findMessageIndexInVirtualList(
  virtualItems: VirtualListItem[],
  messageId: string
): number {
  return virtualItems.findIndex(
    (item) => item.type === 'message' && item.message.id === messageId
  );
}

// === 滚动稳定性（修复「消息列表上下来回弹」） ===
// 下面两个纯函数把 MessageList 里的滚动决策抽出来，便于单测覆盖边界。

/** 「回到最新」按钮的显示阈值（距底部超过它才显示） */
export const SCROLL_BTN_SHOW_THRESHOLD = 240;
/** 「回到最新」按钮的隐藏阈值（回到它以内立即隐藏），必须小于显示阈值 */
export const SCROLL_BTN_HIDE_THRESHOLD = 120;

/**
 * 滞回判定：是否显示「回到最新」按钮。
 *
 * 单阈值会在阈值附近抖动 —— 内容高度变化（输入中指示器 ±28px、图片加载、虚拟列表
 * 测量修正）让「距底部」在 120px 上下反复穿越时，按钮会反复闪现/消失，视觉上就是
 * 「右侧气泡上下来回弹」。这里用两个阈值：已显示时只有回到 120px 以内才隐藏，
 * 未显示时必须超过 240px 才显示，中间 120~240px 是「保持现状」的死区。
 *
 * @param distanceToBottom 距底部距离（scrollHeight - scrollTop - clientHeight）
 * @param currentlyShown 当前按钮是否已显示
 */
export function resolveShowScrollBtn(
  distanceToBottom: number,
  currentlyShown: boolean,
  showThreshold: number = SCROLL_BTN_SHOW_THRESHOLD,
  hideThreshold: number = SCROLL_BTN_HIDE_THRESHOLD
): boolean {
  return currentlyShown ? distanceToBottom > hideThreshold : distanceToBottom > showThreshold;
}

/**
 * 区分「顶部插入历史（prepend）」与「底部追加新消息（append）」。
 *
 * 两者都会让虚拟列表长度变大，但**append 一定会改变末项 key，prepend 不会**。
 * 若把 prepend 当成新消息，会把正在上滑看历史的用户直接拽到底部（实测被拽走
 * ~3800px），并把历史消息误计入未读数、误显示「新消息」分隔线。
 *
 * @param len 当前列表长度
 * @param prevLen 上一次列表长度
 * @param lastKey 当前末项 key
 * @param prevLastKey 上一次末项 key
 */
export function isPrependGrowth(
  len: number,
  prevLen: number,
  lastKey: string | number | null,
  prevLastKey: string | number | null
): boolean {
  if (len <= prevLen) return false;
  // 首次渲染（prevLastKey 为空）没有可比基线，不算 prepend
  if (prevLastKey === null || lastKey === null) return false;
  return lastKey === prevLastKey;
}

/**
 * 顶部插入历史（prepend）后，为「保持视口所看内容不动」应设置的 scrollTop。
 *
 * 虚拟列表把历史消息插到顶部时，列表整体高度增加；若不补偿，浏览器会把 scrollTop
 * 留在原值，视口内容被整体顶走（实测一次插入 ~1380px，表现为内容突然跳一下）。
 * 补偿量 = 新增高度，即 anchorTop + (newHeight - anchorHeight)。
 *
 * @param anchorTop 插入前的 scrollTop
 * @param anchorHeight 插入前的 scrollHeight
 * @param newHeight 插入后的 scrollHeight
 */
export function computePrependScrollTop(
  anchorTop: number,
  anchorHeight: number,
  newHeight: number
): number {
  return anchorTop + (newHeight - anchorHeight);
}

/** 「贴底」判定阈值：距底部小于它才认为用户正贴着最新消息（比自动滚动阈值更紧） */
export const PINNED_THRESHOLD = 48;

/**
 * 贴底跟随的目标 scrollTop（内容末端，越界由浏览器钳制）。
 *
 * 这里**刻意不做增量补偿**（即不用 scrollTop += 高度差）。原因是：
 * 内容变矮时，浏览器在布局阶段会先把 scrollTop 自行钳制到新的最大值，
 * 若 ResizeObserver 回调里再叠加一次负增量，就会「多减一次」，把视口整体
 * 顶上去 —— 这恰恰就是要修的「上下来回弹」。
 * （实测：垫片 +100 再移除，增量法最终 dist=100，对齐法 dist=0。）
 *
 * 直接对齐到内容末端天然免疫重复补偿：变高时跟到新底部，变矮时也停在新底部。
 */
export function pinnedScrollTop(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight);
}
