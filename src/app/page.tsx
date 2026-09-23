'use client';

import ChatClient from './ChatClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function Home() {
  return (
    <main>
      <ErrorBoundary>
        <ChatClient />
      </ErrorBoundary>
    </main>
  );
}
