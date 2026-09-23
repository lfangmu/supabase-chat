import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { hashPassword, extractSession } from '@/lib/auth';
import { AUTH_CONFIG } from '@/config';

export const runtime = 'edge';

/**
 * POST /api/auth/recover
 *
 * 账号自愈端点：用于「会话 JWT 仍有效，但 users / room_members 数据被清除」的锁定场景
 * （JWT 是无状态的，middleware 只验签名不查库，因此数据被删后旧 cookie 仍被放行，
 *  但 /api/me 返回 401「用户不存在」、进群/发消息 403「无权…」）。
 *
 * 安全前提：middleware 已要求本路由携带「有效」会话 JWT（签名正确且未过期），
 *  因此只有账号本人的合法会话才能触发自愈，无法越权恢复他人账号。
 *
 * 行为（只增不删）：
 *  1) users 行缺失则重建（写入新密码哈希；旧密码已随行丢失，故需客户端提供 newPassword）；
 *  2) 重新加入全部房间（room_members 与 users 无外键，需单独补全；memberships 不可恢复时
 *     以「重新加入全部房间」作为恢复启发式，优先恢复功能而非精确还原历史成员关系）。
 *
 * body: { newPassword?: string } —— 不传则生成占位哈希（当前会话不受影响，但日后需走重置脚本才能再登录）。
 */
export async function POST(request: NextRequest) {
  try {
    const jwtSecret = (process.env.CHAT_JWT_SECRET ?? '').trim();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, message: '服务器配置错误：未配置 CHAT_JWT_SECRET' }, { status: 500 });
    }

    // 必须有有效会话（JWT 签名 + 未过期），才能自证身份
    const session = await extractSession(request.headers.get('cookie'), jwtSecret);
    if (!session.valid || !session.payload?.nickname) {
      return NextResponse.json({ success: false, message: '会话已失效，请重新登录或注册' }, { status: 401 });
    }
    const nickname = session.payload.nickname as string;

    let newPassword: string | undefined;
    try {
      const body = await request.json();
      newPassword = typeof body?.newPassword === 'string' ? body.newPassword : undefined;
    } catch {
      /* 无 body 时视为不设置密码 */
    }
    if (newPassword && (newPassword.length < 6 || newPassword.length > 128)) {
      return NextResponse.json({ success: false, message: '密码需 6-128 个字符' }, { status: 400 });
    }

    const supabase = getServiceClient();

    // ---- 1) 重建 users 行（仅当缺失；存在则跳过以保留原头像/签名）----
    const { data: existing } = await supabase
      .from('users')
      .select('nickname')
      .eq('nickname', nickname)
      .maybeSingle();

    if (!existing) {
      const password_hash = newPassword
        ? await hashPassword(newPassword)
        : `pbkdf2:sha256:0:recover:${crypto.randomUUID()}`; // 占位：无法用旧密码登录，需走重置脚本
      const { error } = await supabase.from('users').insert({
        nickname,
        password_hash,
        signature: '',
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      });
      if (error) {
        console.error('[RECOVER_INSERT_ERROR]', error.message, error.details, error.hint, error.code);
        return NextResponse.json({ success: false, message: '恢复失败，请稍后重试' }, { status: 500 });
      }
    }

    // ---- 2) 重新加入全部房间 ----
    const { data: rooms, error: roomsErr } = await supabase.from('rooms').select('id, created_by');
    if (roomsErr) {
      console.error('[RECOVER_ROOMS_ERROR]', roomsErr.message);
      return NextResponse.json({ success: false, message: '恢复失败：读取房间列表错误' }, { status: 500 });
    }
    let joined = 0;
    for (const room of rooms || []) {
      const role = room.created_by === nickname ? 'owner' : 'member';
      const { error } = await supabase
        .from('room_members')
        .upsert(
          { room_id: room.id, user: nickname, role, joined_at: new Date().toISOString() },
          { onConflict: 'room_id,user' }
        );
      if (!error) joined++;
    }

    return NextResponse.json({ success: true, recovered: !existing, roomsJoined: joined });
  } catch (err) {
    console.error('[RECOVER_ERROR]', err);
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}
