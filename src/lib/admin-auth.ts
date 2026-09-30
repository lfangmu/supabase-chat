import { NextResponse } from 'next/server';
import { getServiceClient } from './service-client';
import { getAuthUser } from './auth-user';

export type AdminAuthResult =
  | { ok: true; actor: string }
  | { ok: false; response: NextResponse };

/**
 * 路由内的管理员校验（CODE-REVIEW-2026-09-28.md P1-3）。
 *
 * 问题现象：`/api/admin/rooms`、`/api/admin/messages`、`/api/admin/audit-logs`
 * 三个路由此前只调用 `getAuthUser()`（**任何登录用户都通过**），注释写「再解析 actor
 * 兜底校验一次」但实际没有 role 判断，全部依赖 `src/middleware.ts` 的单点防护。
 * 一旦 matcher 调整、middleware 出现回归，或路由被直接调用，任何登录用户即可
 * 删除任意群聊及其全部消息、删除任意消息、读取全部审计日志。
 *
 * 修复后预期结果：三个路由各自独立断言 `users.role === 'admin'`，
 * 非管理员一律 403，未登录 401，形成纵深防御（middleware 仍保留）。
 *
 * 失败即关闭（fail-closed）：role 查询出错时返回 500，绝不放过。
 */
export async function requireAdmin(request: Request): Promise<AdminAuthResult> {
  const actor = await getAuthUser(request);
  if (!actor) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: '未认证的管理员会话' },
        { status: 401 }
      ),
    };
  }

  const supabase = getServiceClient();
  const { data: me, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', actor)
    .maybeSingle();

  if (error) {
    console.error('requireAdmin: 查询 users.role 失败', error);
    return {
      ok: false,
      response: NextResponse.json({ success: false, message: '权限校验失败' }, { status: 500 }),
    };
  }

  if (me?.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 }),
    };
  }

  return { ok: true, actor };
}
