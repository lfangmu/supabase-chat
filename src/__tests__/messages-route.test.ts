import { describe, it, expect, vi, beforeEach } from 'vitest';

const ACTOR = 'actor-uuid';

describe('POST /api/messages 转发字段', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('把 forwarded_from 透传到数据库，并以 id 为冲突键做幂等 upsert', async () => {
    let upsertPayload: any = null;
    let upsertOptions: any = null;

    const chain: any = {};
    const methods = ['select', 'eq', 'order', 'limit', 'in', 'is', 'ilike', 'gte', 'lte', 'or', 'like', 'neq', 'update'];
    for (const m of methods) chain[m] = vi.fn(() => chain);
    // 幂等写入走 upsert（insert 的 options 里不支持 onConflict/ignoreDuplicates）。
    chain.upsert = vi.fn((rows: any[], options: any) => {
      upsertPayload = rows[0];
      upsertOptions = options;
      return { then: (r: (v: any) => void) => Promise.resolve({ error: null }).then(r) };
    });
    chain.then = (r: (v: any) => void) => Promise.resolve({ data: null, error: null }).then(r);

    const supabase: any = { from: vi.fn(() => chain) };

    vi.doMock('@/lib/service-client', () => ({ getServiceClient: () => supabase }));
    vi.doMock('@/lib/auth-user', () => ({
      getAuthUser: async () => ACTOR,
      getDisplayName: async () => '测试用户',
    }));
    vi.doMock('@/lib/rooms', () => ({
      isRoomParticipant: async () => true,
    }));

    const { POST } = await import('@/app/api/messages/route');
    const body = {
      id: 'msg-new',
      room_id: 'default-room',
      type: 'text',
      content: '转发的内容',
      timestamp: '2026-09-27T12:00:00.000Z',
      forwarded_from: 'src-msg-id',
    };
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(upsertPayload).not.toBeNull();
    expect(upsertPayload.forwarded_from).toBe('src-msg-id');
    // 幂等语义必须真的落到请求上：重发撞主键时应被忽略，而不是报 23505。
    expect(upsertOptions).toEqual({ onConflict: 'id', ignoreDuplicates: true });
  });
});
