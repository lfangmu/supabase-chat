'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';

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

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose }) => {
  const [activeCategory, setActiveCategory] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
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
  }, [onClose]);

  const handleSelect = useCallback((emoji: string) => {
    onSelect(emoji);
    onClose();
  }, [onSelect, onClose]);

  return (
    <div
      ref={pickerRef}
      className="absolute bottom-full left-0 mb-2 w-80 bg-popover rounded-xl shadow-2xl border border-border z-50 overflow-hidden"
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
        {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji) => (
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
};

export default EmojiPicker;