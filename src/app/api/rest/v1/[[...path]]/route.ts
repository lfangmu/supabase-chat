import { proxySupabase } from '@/lib/supabaseProxy';

export const runtime = 'edge';

type Ctx = { params: { path?: string[] } };

export async function GET(req: Request, { params }: Ctx) {
  return proxySupabase(req, 'rest', params.path ?? []);
}
export async function POST(req: Request, { params }: Ctx) {
  return proxySupabase(req, 'rest', params.path ?? []);
}
export async function PUT(req: Request, { params }: Ctx) {
  return proxySupabase(req, 'rest', params.path ?? []);
}
export async function PATCH(req: Request, { params }: Ctx) {
  return proxySupabase(req, 'rest', params.path ?? []);
}
export async function DELETE(req: Request, { params }: Ctx) {
  return proxySupabase(req, 'rest', params.path ?? []);
}
export async function OPTIONS(req: Request, { params }: Ctx) {
  return proxySupabase(req, 'rest', params.path ?? []);
}
