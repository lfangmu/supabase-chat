'use client';

import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export default function NetworkBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-destructive text-destructive-foreground flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium shadow-lg safe-area-inset-top">
      <WifiOff className="w-4 h-4" />
      <span>网络已断开，消息将无法实时送达</span>
    </div>
  );
}
