import { handleRealtimeSSE } from '@/lib/realtimeProxy';

export const runtime = 'edge';

// SSE 长连接（接收）：浏览器连 GET /api/realtime?rooms=...&apikey=...&token=...
export async function GET(request: Request) {
  return handleRealtimeSSE(request);
}
