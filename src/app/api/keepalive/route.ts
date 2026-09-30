import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

// 轻量保活端点：防止 Supabase 免费项目因长时间无活动被自动暂停（auto-pause）。
//
// 用法：用外部 uptime 监控（如 UptimeRobot 免费版）每 5 分钟 GET 一次本端点。
// 每次成功查询都算一次“数据库活动”，足以让免费项目保持唤醒、不再被冻结。
//
// 若项目当前已被暂停，下面的查询会返回 "Project is paused" 错误 ——
// 请先到 Supabase Dashboard 手动 Restore 一次，之后本端点（配合监控）即可持续保活。
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // P2-12：不再回退到 anon/publishable key —— 与 `src/lib/service-client.ts` 的
  // 「fail-loud」原则一致。静默降级到 anon key 会掩盖配置错误，
  // 并且让「保活」这件事在 RLS 收紧后悄悄失效（anon 读不到 messages）。
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    console.error('keepalive: 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
    return NextResponse.json(
      { ok: false, error: 'missing supabase env' },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceRole);
  const { error } = await supabase
    .from('messages')
    .select('count', { count: 'exact', head: true });

  if (error) {
    // P2-12：本端点是**未认证**的公开路径，绝不能把 DB 错误原文（可能含表名、
    // 连接串片段、Supabase 项目状态等）返回给调用方 —— 只记服务端日志。
    console.error('keepalive: DB 查询失败', error.message);
    return NextResponse.json(
      { ok: false, error: 'database unavailable' },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, ts: Date.now() });
}
