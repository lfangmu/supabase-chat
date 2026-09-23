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
    const dateKey = getDateKey(message.timestamp);

    // Insert separator if date changed from previous message
    if (dateKey !== lastDateKey) {
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
