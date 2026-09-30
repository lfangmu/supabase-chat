// Lightweight notification system: sound + browser notification
// Uses Web Audio API to generate a short beep (no external audio files)

/**
 * 复用的 AudioContext 单例（P3 修复）。
 *
 * 此前每次响铃都 `new AudioContext()`，播完再 `close()`。浏览器对**同时存在的**
 * AudioContext 数量有硬上限（Chrome 约 6 个），短时间内连收多条消息时，
 * 「新建 → 关闭」的竞态会让后续若干次响铃直接抛错（被 catch 静默吞掉 → 没声音）。
 * 现在复用同一个 context，只重建振荡器节点，并在结束后断开，避免节点累积。
 */
import { STORAGE_CONFIG_KEYS } from '@/config';

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    try {
      sharedAudioContext = new Ctor();
    } catch {
      return null;
    }
  }
  return sharedAudioContext;
}

/** Play a short notification beep — reuses a single module-level AudioContext. */
export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* ignore */ });

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.frequency.setValueAtTime(800, ctx.currentTime);
    oscillator.type = 'sine';

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);

    // 播放结束后断开节点，避免长会话中节点持续累积（context 本身保留复用）
    oscillator.addEventListener('ended', () => {
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
    });
  } catch {
    // Audio not available, silently fail
  }
}

/** Request browser notification permission (call once on user interaction) */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** Show a browser notification (only when page is hidden) */
export function showBrowserNotification(title: string, body: string) {
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'chat-message',
    });

    // Auto-close after 5s
    setTimeout(() => notification.close(), 5000);

    // Focus the window when clicked
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Notification API not available
  }
}

/** Handle incoming message notification: sound always + browser notification only when hidden */
export function notifyNewMessage(user: string, content: string, isSelf: boolean) {
  if (isSelf) return;

  // Always play sound (foreground or background)
  playNotificationSound();

  // Haptic feedback when app is in foreground (user is holding the phone)
  if (!document.hidden && typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(30);
  }

  // Browser notification only when page is hidden (WebView doesn't support Notification API well)
  if (document.hidden) {
    showBrowserNotification(user, content);
  }
}

/**
 * REQ-007: @mention notification — NOT restricted by visibilityState.
 * Always shows browser notification and plays sound, even when page is in foreground.
 */
export function notifyMention(roomName: string, sender: string, content: string) {
  // Always play sound (foreground or background)
  playNotificationSound();

  // Always show browser notification (not restricted by visibilityState)
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const title = `📢 ${roomName || '群聊'}`;
    const body = `${sender}: ${content}`;
    const notification = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'chat-mention',
      requireInteraction: false,
    });

    // Auto-close after 8s (longer than normal messages)
    setTimeout(() => notification.close(), 8000);

    // Focus the window when clicked
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Notification API not available
  }
}

/**
 * Check if a message content mentions a specific user.
 * Matches @nickname (case-insensitive, trim-compared, exact match — no substring matching).
 */
export function isMentioned(content: string, nickname: string): boolean {
  if (!nickname.trim() || !content) return false;
  const trimmedNickname = nickname.trim();

  // Match @nickname patterns — the nickname ends at whitespace or end of string
  // Using word boundary after the nickname to prevent substring matches
  const escaped = trimmedNickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`@${escaped}(?=[\\s,.;:!?]|$)`, 'i');
  return pattern.test(content);
}

/** Add a room to the mentioned rooms list in localStorage */
export function addMentionedRoom(roomId: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEYS.MENTIONED_ROOMS_KEY);
    const rooms: string[] = raw ? JSON.parse(raw) : [];
    if (!rooms.includes(roomId)) {
      rooms.push(roomId);
      localStorage.setItem(STORAGE_CONFIG_KEYS.MENTIONED_ROOMS_KEY, JSON.stringify(rooms));
    }
  } catch {
    // ignore
  }
}

/** Remove a room from the mentioned rooms list (when user views the room) */
export function removeMentionedRoom(roomId: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEYS.MENTIONED_ROOMS_KEY);
    const rooms: string[] = raw ? JSON.parse(raw) : [];
    const filtered = rooms.filter((r) => r !== roomId);
    localStorage.setItem(STORAGE_CONFIG_KEYS.MENTIONED_ROOMS_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}

/** Get the set of mentioned room IDs */
export function getMentionedRooms(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEYS.MENTIONED_ROOMS_KEY);
    const rooms: string[] = raw ? JSON.parse(raw) : [];
    return new Set(rooms);
  } catch {
    return new Set();
  }
}
