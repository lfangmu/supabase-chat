import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { extractSession } from '@/lib/auth';

export const runtime = 'edge';


/**
 * GET /api/admin/audit-logs — 管理后台：查看操作审计日志
 *
 * 鉴权：仅认 admin_session cookie（isAdmin:true）。
 * 参数：
 *   - action: 按操作类型筛选（可选）
 *   - limit: 返回条数，默认 100，最大 500
 *   - before: 分页游标（ISO 时间戳）
 */
export async function GET(request: NextRequest) {
  try {
    const jwtSecret = process.env.CHAT_JWT_SECRET;
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, message: '服务器配置错误' },
        { status: 500 }
      );
    }

    const session = await extractSession(
      request.headers.get('cookie'),
      jwtSecret,
      'admin_session'
    );
    if (!session.valid || session.payload?.isAdmin !== true) {
      return NextResponse.json(
        { success: false, message: '未认证的管理员会话' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const before = searchParams.get('before');

    const supabase = getServiceClient();

    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (action) {
      query = query.eq('action', action);
    }

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Admin audit logs fetch failed:', error);
      return NextResponse.json(
        { success: false, message: '获取审计日志失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, logs: data || [] });
  } catch (err) {
    console.error('GET /api/admin/audit-logs error:', err);
    return NextResponse.json(
      { success: false, message: '服务器错误' },
      { status: 500 }
    );
  }
}
