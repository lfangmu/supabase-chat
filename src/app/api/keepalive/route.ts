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
  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_KEY;

  if (!url || !serviceRole) {
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
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, ts: Date.now() });
}
