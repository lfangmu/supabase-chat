#!/usr/bin/env node
// 本地工具：为使用旧版高迭代哈希（Cloudflare Workers 的 Web Crypto 不支持 >100000
// 迭代，故旧账号登录会失败）的账号重设密码，改写为当前 100000 迭代的哈希。
//
// 用法：
//   node scripts/reset-password.mjs <nickname> <newPassword>
//
// 说明：
//   - 必须在本地运行（Node 的 crypto 无 100000 迭代上限，可正常派生）。
//   - 通过 service-role key 直写 Supabase（需 .env.local 或环境变量配置）。
//   - 这会覆盖该账号原有密码，新密码由你指定（因为旧哈希已无法验证，无法"找回"）。
//
// 示例：
//   node scripts/reset-password.mjs <昵称> <新密码>

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

const [, , nickname, newPassword] = process.argv;
if (!nickname || !newPassword) {
  console.error('用法: node scripts/reset-password.mjs <nickname> <newPassword>');
  process.exit(1);
}
if (newPassword.length < 6) {
  console.error('新密码至少 6 个字符');
  process.exit(1);
}

const ITER = 100_000;
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(newPassword, salt, ITER, 32, 'sha256');
const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const stored = `pbkdf2:sha256:${ITER}:${b64url(salt)}:${b64url(hash)}`;

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
const { error } = await sb.from('users').update({ password_hash: stored }).eq('nickname', nickname);
if (error) {
  console.error('更新失败:', error.message);
  process.exit(1);
}
console.log(`已为账号 "${nickname}" 重设密码（迭代 ${ITER}），现在可在线上正常登录。`);
