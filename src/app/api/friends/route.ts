import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'edge';


/**
 * 规范化双向主键：user_a < user_b（字典序）
 *
 * user_a / user_b 只是为了让「A→B」和「B→A」落在同一行，顺序由昵称
 * 字典序决定，与谁发起申请无关。判断申请方向必须看 requested_by，
 * 拿 user_a/user_b 的位置当收发件人会在半数昵称组合下彻底反向。
 */
function normalize(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

interface FriendRow {
  user_a: string;
  user_b: string;
  status: 'pending' | 'accepted' | 'blocked';
  requested_by: string;
  note: string;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/friends?user=A
 * 返回该用户的好友全景：
 *  - friends:  已互为好友
 *  - incoming: 别人发来的待通过申请（pending 且 requested_by ≠ A）
 *  - outgoing: 我发出的待通过申请（pending 且 requested_by = A）
 *  - blocked:  被我拉黑的用户
 */
export async function GET(request: NextRequest) {
  try {
    // 只能查看自己的好友关系（防枚举他人好友列表）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const user = request.nextUrl.searchParams.get('user')?.trim();
    if (!user) {
      return NextResponse.json({ success: false, message: '缺少用户' }, { status: 400 });
    }
    if (user !== actor) {
      return NextResponse.json({ success: false, message: '只能查看自己的好友' }, { status: 403 });
    }
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('friends')
      .select('*')
      .or(`user_a.eq.${user},user_b.eq.${user}`);

    if (error) {
      return NextResponse.json({ success: false, message: '获取好友失败' }, { status: 500 });
    }

    const friends: string[] = [];
    const incoming: { nickname: string; created_at: string }[] = [];
    const outgoing: { nickname: string; created_at: string }[] = [];
    const blocked: string[] = [];

    for (const row of (data || []) as FriendRow[]) {
      const other = row.user_a === user ? row.user_b : row.user_a;
      if (row.status === 'accepted') friends.push(other);
      else if (row.status === 'blocked') blocked.push(other);
      else if (row.status === 'pending') {
        // 方向看 requested_by：我发起的是 outgoing，否则是别人发给我的
        if (row.requested_by === user) outgoing.push({ nickname: other, created_at: row.created_at });
        else incoming.push({ nickname: other, created_at: row.created_at });
      }
    }

    // 拉取好友资料（头像/签名）
    let profiles: Record<string, { avatar: string | null; signature: string }> = {};
    if (friends.length) {
      const { data: pd } = await supabase
        .from('users')
        .select('nickname, avatar, signature')
        .in('nickname', friends);
      (pd || []).forEach((p: { nickname: string; avatar: string | null; signature: string }) => {
        profiles[p.nickname] = { avatar: p.avatar, signature: p.signature };
      });
    }

    return NextResponse.json({
      success: true,
      friends: friends.map((nick) => ({ nickname: nick, ...(profiles[nick] || { avatar: null, signature: '' }) })),
      incoming,
      outgoing,
      blocked,
    });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/**
 * POST /api/friends — 发送好友申请（或在对方已申请我时直接通过）
 * body: { user, target }
 */
export async function POST(request: NextRequest) {
  try {
    // 只能以本人身份发起申请（防伪造他人身份申请）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const user = (body.user as string)?.trim();
    const target = (body.target as string)?.trim();
    if (!user || !target || user === target) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }
    if (user !== actor) {
      return NextResponse.json({ success: false, message: '只能以本人身份申请' }, { status: 403 });
    }
    const [a, b] = normalize(user, target);
    const supabase = getServiceClient();

    // 确认双方都是已注册用户
    const { data: users } = await supabase.from('users').select('nickname').in('nickname', [user, target]);
    const have = new Set((users || []).map((u: { nickname: string }) => u.nickname));
    if (!have.has(user) || !have.has(target)) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
    }

    // 查现有关系
    const { data: exist } = await supabase.from('friends').select('*').eq('user_a', a).eq('user_b', b).maybeSingle();
    const row = exist as FriendRow | null;

    if (row && row.status === 'accepted') {
      return NextResponse.json({ success: true, status: 'accepted', message: '已是好友' });
    }
    if (row && row.status === 'blocked') {
      return NextResponse.json({ success: false, message: '已被拉黑，无法添加' }, { status: 403 });
    }
    // 对方已向我发出申请 → 我这次点击即视为通过
    if (row && row.status === 'pending' && row.requested_by !== user) {
      const { error } = await supabase
        .from('friends')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('user_a', a)
        .eq('user_b', b);
      if (error) return NextResponse.json({ success: false, message: '通过失败' }, { status: 500 });
      return NextResponse.json({ success: true, status: 'accepted', message: '已添加为好友' });
    }

    // 新建 pending 申请
    const { error } = await supabase
      .from('friends')
      .upsert({ user_a: a, user_b: b, status: 'pending', requested_by: user, updated_at: new Date().toISOString() }, { onConflict: 'user_a,user_b' });
    if (error) return NextResponse.json({ success: false, message: '申请失败' }, { status: 500 });
    return NextResponse.json({ success: true, status: 'pending', message: '好友申请已发送' });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/**
 * PUT /api/friends — 通过/拒绝申请
 * body: { user, target, action: 'accept' | 'reject' }
 */
export async function PUT(request: NextRequest) {
  try {
    // 只能处理「发给自己的」申请，且以本人身份操作（防伪造他人通过申请）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const user = (body.user as string)?.trim();
    const target = (body.target as string)?.trim();
    const action = body.action as 'accept' | 'reject';
    if (!user || !target || (action !== 'accept' && action !== 'reject')) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }
    if (user !== actor) {
      return NextResponse.json({ success: false, message: '只能处理自己的申请' }, { status: 403 });
    }
    const [a, b] = normalize(user, target);
    const supabase = getServiceClient();

    // 只有「收到申请的一方」(requested_by ≠ 当前用户) 能处理。
    // 注意：user_a/user_b 按昵称字典序排序，与收发无关，不能拿 user_b 当收件人。
    const { data: row } = await supabase.from('friends').select('*').eq('user_a', a).eq('user_b', b).maybeSingle();
    if (!row) return NextResponse.json({ success: false, message: '无申请记录' }, { status: 404 });
    if (row.requested_by === user) {
      return NextResponse.json({ success: false, message: '无权处理该申请' }, { status: 403 });
    }
    if (row.status !== 'pending') {
      return NextResponse.json({ success: true, status: row.status, message: '已处理' });
    }

    if (action === 'accept') {
      const { error } = await supabase
        .from('friends')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('user_a', a)
        .eq('user_b', b);
      if (error) return NextResponse.json({ success: false, message: '通过失败' }, { status: 500 });
      return NextResponse.json({ success: true, status: 'accepted' });
    } else {
      const { error } = await supabase.from('friends').delete().eq('user_a', a).eq('user_b', b);
      if (error) return NextResponse.json({ success: false, message: '拒绝失败' }, { status: 500 });
      return NextResponse.json({ success: true, status: 'rejected' });
    }
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/**
 * DELETE /api/friends — 删除好友 / 拉黑 / 取消拉黑
 * body: { user, target, action: 'remove' | 'block' | 'unblock' }
 */
export async function DELETE(request: NextRequest) {
  try {
    // 只能以本人身份删除/拉黑/取消拉黑（防伪造他人关系操作）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const user = (body.user as string)?.trim();
    const target = (body.target as string)?.trim();
    const action = body.action as 'remove' | 'block' | 'unblock';
    if (!user || !target || !action) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }
    if (user !== actor) {
      return NextResponse.json({ success: false, message: '只能操作自己的关系' }, { status: 403 });
    }
    const [a, b] = normalize(user, target);
    const supabase = getServiceClient();

    if (action === 'remove') {
      const { error } = await supabase.from('friends').delete().eq('user_a', a).eq('user_b', b);
      if (error) return NextResponse.json({ success: false, message: '删除失败' }, { status: 500 });
      return NextResponse.json({ success: true, status: 'removed' });
    }
    if (action === 'block') {
      const { error } = await supabase
        .from('friends')
        .upsert({ user_a: a, user_b: b, status: 'blocked', requested_by: user, updated_at: new Date().toISOString() }, { onConflict: 'user_a,user_b' });
      if (error) return NextResponse.json({ success: false, message: '拉黑失败' }, { status: 500 });
      return NextResponse.json({ success: true, status: 'blocked' });
    }
    // unblock → 删掉这条关系
    const { error } = await supabase.from('friends').delete().eq('user_a', a).eq('user_b', b);
    if (error) return NextResponse.json({ success: false, message: '取消拉黑失败' }, { status: 500 });
    return NextResponse.json({ success: true, status: 'unblocked' });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
