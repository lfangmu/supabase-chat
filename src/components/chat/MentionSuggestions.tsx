'use client';

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { PresenceUser } from '@/hooks/usePresence';
import Avatar from './Avatar';

interface MentionSuggestionsProps {
  query: string;
  users: PresenceUser[];
  onSelect: (nickname: string) => void;
  onClose: () => void;
}

const MentionSuggestions: React.FC<MentionSuggestionsProps> = ({ query, users, onSelect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return users.filter((u) => u.nickname.toLowerCase().includes(q)).slice(0, 6);
  }, [query, users]);

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length]);

  // Scroll active item into view
  useEffect(() => {
    if (!ref.current) return;
    const activeEl = ref.current.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSelect = useCallback((nickname: string) => {
    onSelect(nickname);
  }, [onSelect]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const active = filtered[activeIndex];
        if (active) handleSelect(active.nickname);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, filtered, activeIndex, handleSelect]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-56 bg-popover rounded-xl shadow-2xl border border-border z-50 overflow-hidden"
      role="listbox"
      aria-label="提及用户"
    >
      {filtered.map((u, index) => (
        <button
          key={u.id}
          onClick={() => handleSelect(u.nickname)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
            index === activeIndex ? 'bg-accent' : 'hover:bg-accent'
          }`}
          role="option"
          aria-selected={index === activeIndex}
        >
          <Avatar name={u.nickname} size={24} rounded="full" />
          <span className="text-foreground">@{u.nickname}</span>
        </button>
      ))}
    </div>
  );
};

export default MentionSuggestions;
