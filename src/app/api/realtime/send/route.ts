import { handleRealtimeSend } from '@/lib/realtimeProxy';

export const runtime = 'edge';

// 短连接转发 broadcast（发送）：POST /api/realtime/send
export async function POST(request: Request) {
  return handleRealtimeSend(request);
}
