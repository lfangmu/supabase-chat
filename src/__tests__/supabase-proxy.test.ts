import { describe, it, expect } from 'vitest';
import { buildProxyTargetUrl } from '@/lib/supabaseProxy';

const ORIGIN = 'https://chat.example.com';

/** 只断言 pathname + search，避免依赖运行环境的 SUPABASE_URL */
function parts(requestUrl: string, service: 'rest' | 'auth' | 'storage', segs: string[] = []) {
  const u = new URL(buildProxyTargetUrl(requestUrl, service, segs));
  return { pathname: u.pathname, search: u.search, host: u.host };
}

describe('buildProxyTargetUrl（同源代理转发路径）', () => {
  // 这条用例锁死本次修复的 bug：此前依赖 `params.path`，在 Pages 上退化为空数组后
  // 表名被挤进查询串，PostgREST 报 PGRST100 "failed to parse filter (friends)"。
  it('单段表名必须落在 pathname，不能落进查询串', () => {
    const p = parts(`${ORIGIN}/api/rest/v1/friends`, 'rest', ['friends']);
    expect(p.pathname).toBe('/rest/v1/friends');
    expect(p.search).toBe('');
  });

  it('带查询串时查询串原样保留', () => {
    const p = parts(`${ORIGIN}/api/rest/v1/friends?select=id&limit=1`, 'rest', ['friends']);
    expect(p.pathname).toBe('/rest/v1/friends');
    expect(p.search).toBe('?select=id&limit=1');
  });

  it('关键回归：即使 params.path 为空，也要能从请求 URL 恢复子路径', () => {
    // 这正是线上实际发生的情况 —— 可选 catch-all 拿不到 path
    const p = parts(`${ORIGIN}/api/rest/v1/friends?select=id`, 'rest', []);
    expect(p.pathname).toBe('/rest/v1/friends');
    expect(p.search).toBe('?select=id');
  });

  it('多段路径（storage object）保持层级', () => {
    const p = parts(`${ORIGIN}/api/storage/v1/object/avatars/a.png`, 'storage', []);
    expect(p.pathname).toBe('/storage/v1/object/avatars/a.png');
  });

  it('auth 路径与 rest 用同一套规则', () => {
    const p = parts(`${ORIGIN}/api/auth/v1/user`, 'auth', []);
    expect(p.pathname).toBe('/auth/v1/user');
  });

  it('根路径（尾斜杠、无子路径）转发到 /rest/v1/', () => {
    const p = parts(`${ORIGIN}/api/rest/v1/`, 'rest', []);
    expect(p.pathname).toBe('/rest/v1/');
    expect(p.search).toBe('');
  });

  it('只在 pathname 里匹配 marker，不会被查询串误导', () => {
    // 查询串里含 /api/rest/v1/ 时不能被当成路径锚点
    const p = parts(`${ORIGIN}/api/rest/v1/rooms?q=/api/rest/v1/x`, 'rest', ['rooms']);
    expect(p.pathname).toBe('/rest/v1/rooms');
  });

  // 本次修复的真正根因：next-on-pages 把 catch-all 子路径同时注入成 ?path=...
  it('必须剥离 next-on-pages 注入的 path 查询参数（否则 PostgREST 报 PGRST100）', () => {
    // 线上实测 req.search 末尾会凭空多出 &path=friends
    const p = parts(`${ORIGIN}/api/rest/v1/friends?select=id&path=friends`, 'rest', ['friends']);
    expect(p.pathname).toBe('/rest/v1/friends');
    expect(p.search).toBe('?select=id');
  });

  it('多段子路径时注入的 path 参数同样要剥离', () => {
    const p = parts(
      `${ORIGIN}/api/storage/v1/object/avatars/a.png?path=object/avatars/a.png`,
      'storage',
      ['object', 'avatars', 'a.png']
    );
    expect(p.pathname).toBe('/storage/v1/object/avatars/a.png');
    expect(p.search).toBe('');
  });

  it('不得误伤用户真的在以 path 列过滤', () => {
    const p = parts(`${ORIGIN}/api/rest/v1/files?path=eq./a/b`, 'rest', ['files']);
    expect(p.search).toBe('?path=eq./a/b');
  });

  it('转发到 Supabase 的真实 host，而非本应用域名', () => {
    const p = parts(`${ORIGIN}/api/rest/v1/friends`, 'rest', ['friends']);
    expect(p.host).not.toBe('chat.example.com');
    expect(p.host).toMatch(/supabase\.co$/);
  });
});
