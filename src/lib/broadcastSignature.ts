/**
 * 校验服务端签名的 chat-message 实时广播 —— 防伪造 / 防注入（integrity）。
 *
 * 设计：
 * - 服务端 Edge Function（broadcast-message）用 Ed25519 私钥（BROADCAST_SIGNING_KEY）对
 *   消息身份串 `${id}|${roomId}|${timestamp}` 签名，并把 signature 附带在广播 payload 上。
 * - 客户端用公钥校验。公钥默认内联在下方 FALLBACK_VERIFY_KEY（构建进 bundle，无需在
 *   Cloudflare 单独配置构建变量）；也可用环境变量 NEXT_PUBLIC_BROADCAST_VERIFY_KEY
 *   覆盖（用于轮换密钥，免改代码）。
 * - 私钥（BROADCAST_SIGNING_KEY）只存在 Supabase 函数环境变量，永不下发前端；只有持有
 *   service-role key 的服务端能调用该 Edge Function 产生合法签名，因此同房间参与者无法
 *   伪造他人消息（Supabase Realtime Broadcast 是 pub/sub、不受 RLS 约束，原本任何人都能向
 *   chat-room:<id> 注入假消息）。
 *
 * 激活：公钥已内联，前端部署后即默认校验。服务端签名私钥（BROADCAST_SIGNING_KEY）需在
 * Supabase 项目里手动设置（Dashboard → Edge Functions → 对应函数 → Secrets，或本地
 * `supabase secrets set`），不走 CI。须先于/随前端部署生效。若私钥未生效，广播无签名会被
 * 丢弃（无 DB 兜底通道），请按部署顺序操作。
 */

// 内联公钥（Ed25519 SPKI，base64）。与 Supabase 的 BROADCAST_SIGNING_KEY 私钥配对。
// 轮换时改设 Cloudflare 构建变量 NEXT_PUBLIC_BROADCAST_VERIFY_KEY 覆盖本常量即可。
const FALLBACK_VERIFY_KEY = 'MCowBQYDK2VwAyEAj3KMQ1/aI/uxpqMpxYwTtlaGERGYngf1Xv19XT6vrHM=';

let cachedVerifyKey: Promise<CryptoKey | null> | null = null;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function getVerifyKey(): Promise<CryptoKey | null> {
  if (!cachedVerifyKey) {
    cachedVerifyKey = (async () => {
      const b64 = process.env.NEXT_PUBLIC_BROADCAST_VERIFY_KEY || FALLBACK_VERIFY_KEY;
      try {
        const spki = base64ToBytes(b64);
        return await crypto.subtle.importKey(
          'spki',
          spki,
          { name: 'Ed25519' },
          false,
          ['verify']
        );
      } catch (err) {
        console.error('[broadcast-signature] 公钥导入失败，降级为信任模式:', err);
        return null;
      }
    })();
  }
  return cachedVerifyKey;
}

export interface SignedMessage {
  id?: string;
  timestamp?: string;
  signature?: string;
}

/**
 * 校验一条 chat-message 广播是否来自可信服务端。
 * @returns true 表示可信（或处于未配置公钥的过渡期），false 表示应丢弃。
 */
export async function verifyChatMessageBroadcast(
  roomId: string,
  msg: SignedMessage
): Promise<boolean> {
  const key = await getVerifyKey();
  // 公钥已内联（FALLBACK_VERIFY_KEY）：正常情况下 key 恒非空，默认强制校验。
  // 仅当内联公钥导入失败等异常时回退为信任，避免校验逻辑自身崩溃导致整页收不到消息。
  if (!key) return true;
  if (!msg.signature || !msg.id || !msg.timestamp) return false;

  const data = new TextEncoder().encode(`${msg.id}|${roomId}|${msg.timestamp}`);
  const sig = base64ToBytes(msg.signature);
  try {
    return await crypto.subtle.verify('Ed25519', key, sig, data);
  } catch {
    return false;
  }
}
