'use client';

import React from 'react';

interface DateSeparatorProps {
  /** Pre-formatted date label (e.g., "今天", "昨天", "6月23日 星期一") */
  date: string;
}

/**
 * REQ-005: Date separator component rendered between messages on different days.
 * Displays a centered pill-style label with subtle horizontal accent lines.
 */
const DateSeparator: React.FC<DateSeparatorProps> = React.memo(({ date }) => {
  return (
    <div
      className="flex items-center justify-center py-3 select-none"
      role="separator"
      aria-label={date}
    >
      <div className="flex-1 h-px bg-border max-w-[60px]" />
      <span className="px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
        {date}
      </span>
      <div className="flex-1 h-px bg-border max-w-[60px]" />
    </div>
  );
});

DateSeparator.displayName = 'DateSeparator';

export default DateSeparator;
