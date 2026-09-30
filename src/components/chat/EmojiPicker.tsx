'use client';

import React, { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

const EMOJI_CATEGORIES: { name: string; icon: string; emojis: string[] }[] = [
  {
    name: '表情',
    icon: '😀',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮', '😯', '😲', '😳', '🥺', '😢', '😭', '😤', '😡', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻'],
  },
  {
    name: '手势',
    icon: '👍',
    emojis: ['👍', '👎', '👏', '🙌', '🤝', '🤲', '👐', '🙏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '🖕', '☝️', '💪', '🦵', '🦶', '👂', '👃', '🧠', '👀', '👁️', '👅', '👄', '💋'],
  },
  {
    name: '爱心',
    icon: '❤️',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌', '💑', '💏', '👩‍❤️‍👨', '👨‍❤️‍👨', '👩‍❤️‍👩', '💒', '💍', '💎'],
  },
  {
    name: '物品',
    icon: '💡',
    emojis: ['💡', '🔦', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🕹️', '💾', '💿', '📀', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '🎧', '🎤', '🎵', '🎶', '🎼', '🎹', '🎸', '🎻', '🥁', '🎺', '🎷', '🎨', '🎬', '🎮', '🎲', '🎯', '🎳', '🎾', '⚽', '🏀', '🏈', '⚾', '🎉', '🎊', '🎁', '🎈', '🎄', '✨', '⭐', '🌟', '🔥', '💧', '💎', '🎯', '🔔', '🔕', '📌', '📍', '✂️', '🔒', '🔓', '🔑', '🔨', '⚡', '❄️', '🌈', '☀️', '🌙', '⏰', '📅'],
  },
  {
    name: '食物',
    icon: '🍕',
    emojis: ['🍕', '🍔', '🍟', '🌭', '🍿', '🥓', '🥚', '🍳', '🧇', '🥞', '🧈', '🍞', '🥐', '🥖', '🥨', '🥯', '🧀', '🍗', '🍖', '🥩', '🍤', '🍣', '🍱', '🍜', '🍝', '🥟', '🍚', '🍙', '🍛', '🍲', '🥘', '🍰', '🎂', '🧁', '🍪', '🍩', '🍫', '🍬', '🍭', '🍦', '🍨', '🍧', '🍺', '🍻', '🥂', '🍷', '🍸', '🍹', '🧃', '🥤', '🧋', '☕', '🍵', '🧉', '🥛', '🍼'],
  },
  {
    name: '自然',
    icon: '🌲',
    emojis: ['🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🌺', '🌻', '🌹', '🥀', '🌷', '🌼', '🌸', '💐', '🍄', '🌰', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃'],
  },
];

// useLayoutEffect 在 SSR 会报警告；选择器只在客户端交互时出现，但保险起见用同构版。
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /**
   * 触发元素。传入后选择器会渲染到 document.body（脱离任何 overflow:hidden 裁剪上下文），
   * 并用 position:fixed 按视口自动翻转/夹紧位置，彻底解决「表情包只显示一半」的问题。
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** 优先出现的方向：'bottom' 在锚点下方，'top' 在锚点上方（如输入框表情按钮在底部时用 'top'）。默认 'bottom'。 */
  placement?: 'top' | 'bottom';
  /** 水平对齐：'left' 左缘对齐锚点左缘，'right' 右缘对齐锚点右缘（自己发的右侧气泡用 'right' 更自然）。默认 'left'。 */
  align?: 'left' | 'right';
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onSelect,
  onClose,
  anchorRef,
  placement = 'bottom',
  align = 'left',
}) => {
  const [activeCategory, setActiveCategory] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 视口自适应定位：用锚点 getBoundingClientRect + fixed 定位，
  // 空间不足时翻转方向，并保证整体落在视口内（不被 overflow:hidden 裁剪）。
  useIsomorphicLayoutEffect(() => {
    if (!anchorRef?.current) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const panel = pickerRef.current;
      const pw = panel?.offsetWidth ?? 320;
      const ph = panel?.offsetHeight ?? 320;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const M = 8;

      // 垂直方向：优先 placement；放不下则翻转；翻转后仍放不下就夹紧到视口内。
      let top: number;
      if (placement === 'top') {
        top = a.top - ph - 8;
        if (top < M && a.bottom + ph + 8 + M <= vh) {
          top = a.bottom + 8; // 上方放不下 → 翻到下方
        }
      } else {
        top = a.bottom + 8;
        if (top + ph + M > vh && a.top - ph - 8 > M) {
          top = a.top - ph - 8; // 下方放不下 → 翻到上方
        }
      }
      // 水平方向：按 align 决定基准缘；任一方向溢出则夹紧到视口内（保证完全可见）。
      let left: number;
      if (align === 'right') {
        left = a.right - pw;
      } else {
        left = a.left;
      }
      if (left + pw + M > vw) left = vw - pw - M;
      if (left < M) left = M;
      if (top < M) top = M;
      setPos({ top, left });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, placement]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // 点击触发元素本身交给 onClick（开关逻辑）处理，不在此处关闭，避免「关了又被点开」。
      if (anchorRef?.current && anchorRef.current.contains(e.target as Node)) {
        return;
      }
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, anchorRef]);

  const handleSelect = useCallback((emoji: string) => {
    onSelect(emoji);
    onClose();
  }, [onSelect, onClose]);

  const panel = (
    <div
      ref={pickerRef}
      className="bg-popover rounded-xl shadow-2xl border border-border z-[100] overflow-hidden"
      style={{
        position: anchorRef ? 'fixed' : 'absolute',
        // portal 模式下定位算好前先隐藏，避免首帧闪到视口角落。
        visibility: anchorRef && !pos ? 'hidden' : 'visible',
        top: anchorRef && pos ? pos.top : undefined,
        left: anchorRef && pos ? pos.left : undefined,
        width: '20rem', // w-80
        ...(anchorRef ? {} : { bottom: '100%', left: 0, marginBottom: '0.5rem' }),
      }}
      role="dialog"
      aria-label="表情选择器"
    >
      {/* Category tabs */}
      <div className="flex border-b border-border bg-muted/50">
        {EMOJI_CATEGORIES.map((cat, i) => (
          <button
            key={cat.name}
            onClick={() => setActiveCategory(i)}
            className={`flex-1 py-2 text-sm transition-colors ${
              i === activeCategory
                ? 'bg-popover text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label={cat.name}
            title={cat.name}
          >
            {cat.icon}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="p-2 grid grid-cols-8 gap-1 max-h-56 overflow-y-auto">
        {(EMOJI_CATEGORIES[activeCategory]?.emojis ?? []).map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleSelect(emoji)}
            className="w-8 h-8 flex items-center justify-center text-lg hover:bg-muted rounded transition-colors cursor-pointer"
            aria-label={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );

  // 传入 anchorRef 时脱离 overflow:hidden 上下文，渲染到 body；无 anchorRef 走原内联定位（兜底）。
  if (anchorRef && typeof document !== 'undefined') {
    return createPortal(panel, document.body);
  }
  return panel;
};

export default EmojiPicker;
