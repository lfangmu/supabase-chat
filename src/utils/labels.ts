/**
 * 展示用文案工具（CODE-REVIEW-2026-09-28.md P3「重复代码」）。
 *
 * 背景：以下两段逻辑此前在多个组件里各抄一份，需手工同步：
 *  - 媒体类型中文标签（`图片/视频/语音/文件`）：5 处
 *    （`ChatApp.tsx:641,834`、`GlobalSearchModal.tsx:222`、`admin/page.tsx:870,877`、`MessageItem.tsx:207`）
 *  - 相对时间格式化（`刚刚/N 分钟前/N 小时前/N 天前`）：3 处
 *    （`AddFriendModal.tsx:36`、`ContactsPage.tsx:44`，以及语义等价的其它副本）
 *
 * 收敛到本模块作为唯一实现，避免「改一处漏两处」导致同一类型在不同界面显示不一致。
 */

/** 消息类型（与 `src/types/index.ts` 的 `Message['type']` 对齐）。 */
export type MediaMessageType = 'text' | 'image' | 'video' | 'voice' | 'file';

/**
 * 媒体类型的中文标签。
 * @param type 消息类型
 * @returns 中文标签；`text` 返回空串（文本消息直接展示正文，无需标签）
 */
export function mediaTypeLabel(type: string): string {
  switch (type) {
    case 'image':
      return '图片';
    case 'video':
      return '视频';
    case 'voice':
      return '语音';
    case 'file':
      return '文件';
    default:
      return '';
  }
}

/**
 * 非文本消息的占位文案，形如 `[图片]`。
 * 文本消息返回 null，调用方据此决定是否回退到展示 `content`。
 */
export function mediaPlaceholder(type: string): string | null {
  const label = mediaTypeLabel(type);
  return label ? `[${label}]` : null;
}

export interface RelativeTimeOptions {
  /** 是否把「1 天前」显示为「昨天」（联系人最后在线用）。默认 false。 */
  withYesterday?: boolean;
}

/**
 * 相对时间文案。
 *
 * - < 1 分钟 → `刚刚`
 * - < 1 小时 → `N 分钟前`
 * - < 24 小时 → `N 小时前`
 * - withYesterday 且正好 1 天 → `昨天`
 * - < 7 天（或 withYesterday 且 < 7 天）→ `N 天前`
 * - 更早 → `M/D`
 *
 * 无效时间戳返回空串（调用方据此不渲染该字段）。
 */
export function formatRelativeTime(
  timestamp: string | number | Date | null | undefined,
  options: RelativeTimeOptions = {}
): string {
  if (timestamp === null || timestamp === undefined || timestamp === '') return '';
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const time = date.getTime();
  if (!Number.isFinite(time)) return '';

  const diff = Date.now() - time;
  // 未来时间（时钟漂移）按「刚刚」处理，避免出现负数分钟
  if (diff < 60_000) return '刚刚';

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (options.withYesterday && days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;

  return `${date.getMonth() + 1}/${date.getDate()}`;
}
