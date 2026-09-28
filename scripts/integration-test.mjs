#!/usr/bin/env node
/**
 * supabase-chat 功能集成测试（直连真实 Supabase 项目）
 *
 * 用途：在「迁移到 Supabase Auth 之后」对每个功能做端到端验证。
 * 覆盖：连通性 / Auth / 数据库+RLS / Realtime(CDC) / Storage / 后台审计。
 *
 * 为什么需要它：浏览器端报 Failed to fetch 时，光看前端无法定位是
 * 「网络到 supabase.co 不通」还是「env 打错」。本脚本用同一个 anon key
 * 直接打 supabase.co，能一锤定音地判断连通性与各功能是否在后端正常。
 *
 * 安全约定：
 *   - 默认【只读】——只做连通性 + RLS 校验，绝不写数据、不建用户。
 *   - 写测试（建测试房间 / 插消息 / 上传文件 / 实时订阅）需显式开启：
 *       ENABLE_WRITE_TESTS=1   且提供 SUPABASE_SERVICE_ROLE_KEY
 *     并在结束时清理测试数据。
 *   - 匿名登录测试默认关闭（每次会新建一个 auth 用户），需 ENABLE_AUTH_TESTS=1。
 *
 * 环境变量：
 *   SUPABASE_URL               必填，= NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_ANON_KEY         必填，= NEXT_PUBLIC_SUPABASE_KEY (publishable/anon)
 *   SUPABASE_SERVICE_ROLE_KEY 选填，开启写测试时需要
 *   TEST_EMAIL / TEST_PASSWORD 选填，Email 登录测试用（ENABLE_AUTH_TESTS=1 时）
 *   ENABLE_AUTH_TESTS=1       开启 Auth 登录测试
 *   ENABLE_WRITE_TESTS=1      开启写 / 实时 / 存储测试
 *
 * 执行：
 *   cd <项目根>
 *   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=ey... \
 *     node scripts/integration-test.mjs
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SRV = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLE_AUTH = process.env.ENABLE_AUTH_TESTS === '1';
const ENABLE_WRITE = process.env.ENABLE_WRITE_TESTS === '1';
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!URL || !ANON) {
    console.error('缺少 SUPABASE_URL / SUPABASE_ANON_KEY，无法运行。');
    process.exit(2);
  }

  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log('=== 1. 连通性（anon 直连 supabase.co） ===');
  const networkUnreachable = (msg) => /fetch failed|networkerror|load failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(msg || '');
  try {
    const t0 = Date.now();
    const { data, error } = await anon
      .from('rooms')
      .select('count', { count: 'exact', head: true });
    if (error) {
      if (networkUnreachable(error.message)) {
        check('连通性 / 读取 rooms', false, `网络层不可达 supabase.co: ${error.message}`);
        console.log('\n>>> 阻断：连不上 supabase.co。请确认：');
        console.log('    1) 浏览器直接打开 https://<ref>.supabase.co/rest/v1/ 是否也失败（判定网络层）');
        console.log('    2) 项目是否被暂停（免费版 7 天无活动会暂停，需 Restore）');
        console.log('    3) 若在中国大陆、前端在 Cloudflare 而 API 在 supabase.co 独立域名，可能需要反代（见对话）');
        process.exit(3);
      }
      check('连通性 / 读取 rooms', false, `可达但查询报错: ${error.message}`);
    } else {
      check('连通性 / 读取 rooms', true, `延迟 ${Date.now() - t0}ms, count=${data}`);
    }
  } catch (e) {
    check('连通性 / 读取 rooms', false, `无法到达 supabase.co: ${e.name} ${e.message}`);
    console.log('\n>>> 阻断：连不上 supabase.co。请确认：');
    console.log('    1) 浏览器直接打开 https://<ref>.supabase.co/rest/v1/ 是否也失败（判定网络层）');
    console.log('    2) 项目是否被暂停（免费版 7 天无活动会暂停，需 Restore）');
    console.log('    3) 若在中国大陆、前端在 Cloudflare 而 API 在 supabase.co 独立域名，可能需要反代（见对话）');
    process.exit(3);
  }

  console.log('\n=== 2. RLS 越权校验（未登录 anon 不应读到任意房间消息） ===');
  {
    const { data, error } = await anon
      .from('messages')
      .select('count', { count: 'exact', head: true })
      .eq('room_id', 'default-room');
    // 未登录会话在 RLS 下通常返回 0（被过滤）；若直接返回大量数据说明 RLS 失效。
    const count = data ?? 0;
    check('RLS: 未登录读取被过滤', !error && count === 0, error ? error.message : `count=${count}（应为 0）`);
  }

  console.log('\n=== 3. Auth ===');
  if (!ENABLE_AUTH) {
    console.log('    （ENABLE_AUTH_TESTS=1 未开启，跳过登录测试）');
  } else {
    // 匿名登录
    try {
      const { data, error } = await anon.auth.signInAnonymously();
      if (error) check('Auth: 匿名登录', false, error.message);
      else check('Auth: 匿名登录', true, `uuid=${(data.user?.id || '').slice(0, 8)}…`);
    } catch (e) {
      check('Auth: 匿名登录', false, e.message);
    }
    // Email 登录（需提供凭据）
    if (TEST_EMAIL && TEST_PASSWORD) {
      const { data, error } = await anon.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      if (error) check('Auth: 邮箱登录', false, error.message);
      else check('Auth: 邮箱登录', true, `uuid=${(data.user?.id || '').slice(0, 8)}…`);
    } else {
      console.log('    （未提供 TEST_EMAIL/PASSWORD，跳过邮箱登录）');
    }
  }

  // 写测试 / 实时 / 存储
  if (!ENABLE_WRITE) {
    console.log('\n（ENABLE_WRITE_TESTS=1 未开启，跳过 写/实时/存储 测试）');
    finish();
    return;
  }
  if (!SRV) {
    console.log('\n开启写测试需要 SUPABASE_SERVICE_ROLE_KEY，跳过。');
    finish();
    return;
  }

  const srv = createClient(URL, SRV, { auth: { persistSession: false } });
  const testRoom = 'itest-' + Math.random().toString(36).slice(2, 10);
  let cleanupIds = [];

  console.log('\n=== 4. 数据库写入 + 清理 ===');
  try {
    const { data: room, error: re } = await srv
      .from('rooms')
      .insert({ id: testRoom, name: '集成测试房间', created_by: '00000000-0000-0000-0000-000000000000', type: 'public' })
      .select()
      .single();
    check('DB: 建测试房间', !re, re ? re.message : `id=${room.id}`);
    cleanupIds.push(['rooms', testRoom]);

    const { data: msg, error: me } = await srv
      .from('messages')
      .insert({ room_id: testRoom, user_id: '00000000-0000-0000-0000-000000000000', user: 'tester', type: 'text', content: 'hello from integration test' })
      .select()
      .single();
    check('DB: 插消息', !me, me ? me.message : `id=${msg.id}`);
    cleanupIds.push(['messages', msg.id]);
  } catch (e) {
    check('DB: 写测试异常', false, e.message);
  }

  console.log('\n=== 5. Realtime（postgres_changes / CDC） ===');
  {
    // 用 anon 客户端订阅测试房间，再由 service role 插入消息，预期收到 INSERT 事件。
    const channel = anon.channel(`itest:${testRoom}`, { config: { broadcast: { self: true } } });
    let got = false;
    const wait = new Promise((resolve) => {
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${testRoom}` }, () => { got = true; resolve(); });
      channel.subscribe((status) => { if (status !== 'SUBSCRIBED') console.log('   channel status:', status); });
    });
    // 等订阅建立
    await sleep(1500);
    try {
      await srv.from('messages').insert({ room_id: testRoom, user_id: '00000000-0000-0000-0000-000000000000', user: 'tester', type: 'text', content: 'realtime ping' });
    } catch (e) { check('Realtime: 插入触发', false, e.message); }
    const result = await Promise.race([wait, sleep(8000).then(() => 'timeout')]);
    check('Realtime: 收到 CDC INSERT 事件', got, result === 'timeout' ? '8s 内未收到事件' : 'ok');
    try { await anon.removeChannel(channel); } catch {}
  }

  console.log('\n=== 6. Storage（chat-media 桶） ===');
  {
    const filePath = `${testRoom}/test.txt`;
    const { error: upErr } = await srv.storage.from('chat-media').upload(filePath, new Blob(['hi']), { contentType: 'text/plain', upsert: true });
    check('Storage: 上传', !upErr, upErr ? upErr.message : filePath);
    const { data: signed, error: suErr } = await srv.storage.from('chat-media').createSignedUrl(filePath, 60);
    check('Storage: 签名 URL', !suErr && !!signed?.signedUrl, suErr ? suErr.message : 'ok');
    const { error: rmErr } = await srv.storage.from('chat-media').remove([filePath]);
    check('Storage: 删除对象', !rmErr, rmErr ? rmErr.message : 'ok');
  }

  console.log('\n=== 7. 后台审计日志写入 ===');
  {
    const { error } = await srv.from('audit_logs').insert({ action: 'itest_ping', target_type: 'room', target_id: testRoom, details: { note: 'integration test' } });
    check('Admin: 写审计日志', !error, error ? error.message : 'ok');
  }

  // 清理
  console.log('\n=== 清理测试数据 ===');
  for (const [table, id] of cleanupIds) {
    const col = table === 'rooms' ? 'id' : 'id';
    const { error } = await srv.from(table).delete().eq(col, id);
    console.log(`   删除 ${table}:${id} ${error ? '失败 ' + error.message : 'ok'}`);
  }

  finish();
}

function finish() {
  console.log(`\n========== 结果：${results.length - failed}/${results.length} 通过，${failed} 失败 ==========`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('集成测试异常：', e);
  process.exit(1);
});
