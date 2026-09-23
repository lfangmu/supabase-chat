import { createClient } from '@supabase/supabase-js';
import { getClientIp } from './rate-limit';

/**
 * 记录管理后台操作审计日志
 *
 * @param action 操作类型，如 'delete_room'、'delete_message'
 * @param targetType 目标类型，如 'room'、'message'
 * @param targetId 目标 ID
 * @param details 详细信息（JSON 格式）
 * @param adminIp 管理员 IP
 */
export async function logAdminAction(
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown> | null,
  adminIp: string | null
): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.warn('[audit] Missing Supabase config, skipping audit log');
      return;
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { error } = await supabase.from('audit_logs').insert({
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      admin_ip: adminIp,
    });

    if (error) {
      console.error('[audit] Failed to write audit log:', error);
    }
  } catch (err) {
    console.error('[audit] Error writing audit log:', err);
  }
}

/**
 * 从请求中提取客户端 IP（复用 rate-limit 的取真实 IP 逻辑，避免重复实现）
 */
export function getClientIpFromRequest(request: Request): string | null {
  const ip = getClientIp(request);
  return ip === 'unknown' ? null : ip;
}
