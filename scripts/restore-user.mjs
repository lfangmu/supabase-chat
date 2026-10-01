#!/usr/bin/env node
// 本地工具：恢复因「数据丢失」而登录/进群失败的账号。
//
// 适用场景（已确诊）：
//   账号的 users 行被删除（或仅剩无密码的旧昵称行），同时 room_members 行也被清掉，
//   但登录会话 JWT cookie 仍有效（JWT 是无状态的，不查库即放行 middleware），
//   于是呈现：/api/me → 401「用户不存在」、进群/发消息 → 403「无权…」的锁定状态。
//
// 本脚本只做 upsert / insert，绝不删除任何数据：
//   1) 重建 users 行（写入与线上 Edge 一致的 PBKDF2 100000 迭代哈希的新密码）
//   2) 重新加入指定房间（默认：default-room + 你指定的房间；或传 ALL 加入全部房间）
//
// 用法：
//   node scripts/restore-user.mjs <昵称> <新密码> [房间ID ... | ALL]
//
// 示例：
//   node scripts/restore-user.mjs <昵称> <新密码> <房间ID> <房间ID>
//   node scripts/restore-user.mjs <昵称> <新密码> ALL
//
// 说明：
//   - 必须在本地运行（读 .env.local 中的 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）。
//   - service-role 绕过 RLS，可直接写回数据。
//   - 若 users 行已存在（仅缺密码哈希），脚本只补 password_hash，保留原头像/签名。

import crypto from 'node:crypto';
import fs from 'node:fs';

const env = {};
if (fs.existsSync('.env.local')) {
  fs.readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .forEach((l) => {
      const m = l.match(/^([^#=][^=]*)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
    });
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（请配置 .env.local 或环境变量）。');
  process.exit(1);
}

const [, , nickname, newPassword, ...roomArgs] = process.argv;
if (!nickname || !newPassword) {
  console.error('用法: node scripts/restore-user.mjs <昵称> <新密码> [房间ID ... | ALL]');
  process.exit(1);
}
if (newPassword.length < 6) {
  console.error('新密码至少 6 个字符');
  process.exit(1);
}

// 与线上 Edge runtime（Web Crypto）一致的哈希：pbkdf2:sha256:100000:<salt>:<hash>
const ITER = 100_000;
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(newPassword, salt, ITER, 32, 'sha256');
const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const password_hash = `pbkdf2:sha256:${ITER}:${b64url(salt)}:${b64url(hash)}`;

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

// ---- 1) users 行：存在则只补密码；不存在则插入 ----
const { data: existing } = await sb
  .from('users')
  .select('nickname, avatar, signature')
  .eq('nickname', nickname)
  .maybeSingle();

if (existing) {
  const { error } = await sb
    .from('users')
    .update({ password_hash, last_active_at: new Date().toISOString() })
    .eq('nickname', nickname);
  if (error) {
    console.error('更新 users 失败:', error.message);
    process.exit(1);
  }
  console.log(`[users] 已为 "${nickname}" 补上密码哈希（原头像/签名保留）。`);
} else {
  const { error } = await sb.from('users').insert({
    nickname,
    password_hash,
    signature: '',
    created_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
  });
  if (error) {
    console.error('插入 users 失败:', error.message);
    process.exit(1);
  }
  console.log(`[users] 已新建账号 "${nickname}"。`);
}

// ---- 2) room_members：解析目标房间 ----
let targetRooms = roomArgs;
const wantAll = roomArgs.length === 0 || roomArgs.some((r) => r.toUpperCase() === 'ALL');
if (wantAll) {
  const { data: rooms, error } = await sb.from('rooms').select('id');
  if (error) {
    console.error('读取房间列表失败:', error.message);
    process.exit(1);
  }
  targetRooms = (rooms || []).map((r) => r.id);
  console.log(`[rooms] 未指定房间，将对全部 ${targetRooms.length} 个房间执行加入。`);
}

let okCount = 0;
for (const roomId of targetRooms) {
  const { data: room } = await sb.from('rooms').select('created_by').eq('id', roomId).maybeSingle();
  const role = room?.created_by === nickname ? 'owner' : 'member';
  const { error } = await sb.from('room_members').upsert(
    { room_id: roomId, user: nickname, role, joined_at: new Date().toISOString() },
    { onConflict: 'room_id,user' }
  );
  if (error) {
    console.error(`[rooms] 加入 ${roomId} 失败:`, error.message);
  } else {
    console.log(`[rooms] 已加入 ${roomId}（角色 ${role}）。`);
    okCount++;
  }
}

console.log(`\n恢复完成：users 行已就绪，成功加入 ${okCount}/${targetRooms.length} 个房间。`);
console.log('现在可用该昵称 + 新密码重新登录，拉消息/发消息应恢复正常。');
console.log('（注：friends 好友关系若也被清掉需另行处理；messages 表无外键，历史消息通常不受影响。）');
