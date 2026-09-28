import { handleRelayDebug } from '@/lib/realtimeProxy';

export const runtime = 'edge';

// 诊断端点：确认同源 Pages Functions 已部署（版本 / 目标 host）。
export async function GET() {
  return handleRelayDebug();
}
