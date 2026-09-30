import { describe, it, expect, vi, beforeEach } from 'vitest';

// 用 thenable 链式 mock：每个方法都返回自身（可被 await），await 时解析为固定 data。
function makeChain(data: unknown, log: any[][] = []) {
  const chain: any = {};
  const methods = [
    'select', 'in', 'is', 'ilike', 'eq', 'gte', 'lte',
    'order', 'limit', 'or', 'like', 'neq', 'maybeSingle', 'single',
  ];
  for (const m of methods) {
    chain[m] = vi.fn((...args: any[]) => {
      log.push([m, ...args]);
      return chain;
    });
  }
  chain.then = (resolve: (v: any) => void) => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

// 路由会显式校验 actor 是 UUID（因为它会被拼进 PostgREST 的 .or() 过滤器），
// 因此夹具必须用真实形状的 UUID。
const ACTOR = '11111111-2222-4333-8444-555555555555';
const MSG_ROW = {
  id: 'm1', room_id: 'r1', user: 'Alice', content: 'hello world', type: 'text',
  timestamp: '2026-09-27T12:00:00.000Z', file_name: null, file_mime: null, user_id: 'u1',
};

function setupRoute() {
  const msgLog: any[][] = [];
  const msgChain = makeChain([MSG_ROW], msgLog);
  const generic = makeChain([{ room_id: 'r1', id: 'r1', name: 'Room 1', type: 'group' }]);
  const supabase: any = {
    from: vi.fn((table: string) => (table === 'messages' ? msgChain : generic)),
  };
  vi.doMock('@/lib/service-client', () => ({ getServiceClient: () => supabase }));
  vi.doMock('@/lib/auth-user', () => ({ getAuthUser: async () => ACTOR }));
  return { msgLog };
}

describe('GET /api/messages/search 高级筛选', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('默认无筛选：不追加 type / sender / 时间条件', async () => {
    const { msgLog } = setupRoute();
    const { GET } = await import('@/app/api/messages/search/route');
    const req = new Request('http://localhost/api/messages/search?q=hello');
    const res = await GET(req as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(msgLog.some((c) => c[0] === 'eq' && c[1] === 'type')).toBe(false);
    expect(msgLog.some((c) => c[0] === 'ilike' && c[1] === 'user')).toBe(false);
    expect(msgLog.some((c) => c[0] === 'gte')).toBe(false);
    expect(msgLog.some((c) => c[0] === 'lte')).toBe(false);
  });

  it('type=image 追加 .eq(type, image)', async () => {
    const { msgLog } = setupRoute();
    const { GET } = await import('@/app/api/messages/search/route');
    await GET(new Request('http://localhost/api/messages/search?q=hello&type=image') as any);
    expect(msgLog.some((c) => c[0] === 'eq' && c[1] === 'type' && c[2] === 'image')).toBe(true);
  });

  it('sender=Bob 追加 .ilike(user, %Bob%)', async () => {
    const { msgLog } = setupRoute();
    const { GET } = await import('@/app/api/messages/search/route');
    await GET(new Request('http://localhost/api/messages/search?q=hello&sender=Bob') as any);
    expect(msgLog.some((c) => c[0] === 'ilike' && c[1] === 'user' && c[2] === '%Bob%')).toBe(true);
  });

  it('from / to 日期追加 gte / lte，且 to 补齐到当天 23:59:59.999Z', async () => {
    const { msgLog } = setupRoute();
    const { GET } = await import('@/app/api/messages/search/route');
    await GET(
      new Request('http://localhost/api/messages/search?q=hello&from=2026-01-01&to=2026-12-31') as any
    );
    expect(msgLog.some((c) => c[0] === 'gte' && c[1] === 'timestamp' && c[2] === '2026-01-01T00:00:00.000Z')).toBe(true);
    expect(msgLog.some((c) => c[0] === 'lte' && c[1] === 'timestamp' && c[2] === '2026-12-31T23:59:59.999Z')).toBe(true);
  });
});
