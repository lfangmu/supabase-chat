// JWT helper functions for Edge runtime (Web Crypto API)

import { AUTH_CONFIG } from '@/config';

const textEncoder = new TextEncoder();

/** 把字符串编码为 ArrayBuffer 支撑的字节数组（满足 Web Crypto 的 BufferSource 约束）。 */
function encodeBytes(s: string): Uint8Array<ArrayBuffer> {
  const tmp = textEncoder.encode(s);
  const out = new Uint8Array(tmp.byteLength);
  out.set(tmp);
  return out;
}

// ---- 密码哈希（PBKDF2，Web Crypto，Edge/Node 通用）----
// 注意：Cloudflare Workers 的 Web Crypto 对 PBKDF2 迭代次数有硬上限 100000，
// 超过会抛 NotSupportedError。故恒定使用 100000（在约束内尽可能强）。
export const PBKDF2_ITERATIONS = 100_000;
// Cloudflare Workers Web Crypto 对 PBKDF2 迭代次数的硬上限。
export const PBKDF2_MAX_ITERATIONS = 100_000;
const PBKDF2_PREFIX = 'pbkdf2:sha256';

/**
 * 对密码做 PBKDF2-HMAC-SHA256 哈希，返回可存储的带盐格式：
 *   pbkdf2:sha256:<iterations>:<saltBase64Url>:<hashBase64Url>
 * 每个密码独立随机盐，避免彩虹表。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encodeBytes(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hash = new Uint8Array(bits);
  return `${PBKDF2_PREFIX}:${PBKDF2_ITERATIONS}:${base64UrlEncode(salt)}:${base64UrlEncode(hash)}`;
}

/** 校验明文密码与存储哈希是否匹配（恒定时间比较，防时序侧信道）。 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || !stored.startsWith(`${PBKDF2_PREFIX}:`)) return false;
  const parts = stored.split(':');
  if (parts.length !== 5) return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = base64UrlDecode(parts[3]);
  const expectedHash = parts[4];

  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encodeBytes(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  let bits: ArrayBuffer;
  try {
    bits = await globalThis.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    );
  } catch (e) {
    // Cloudflare Workers 对 >100000 迭代直接抛 NotSupportedError，统一为可识别错误，
    // 让登录路由返回清晰提示而非 500。
    if (e instanceof Error && (e.name === 'NotSupportedError' || /iteration/i.test(e.message))) {
      throw new Error('UNSUPPORTED_PBKDF2_ITERATIONS');
    }
    throw e;
  }

  const computedHash = base64UrlEncode(new Uint8Array(bits));
  return constantTimeEqual(computedHash, expectedHash);
}

/**
 * 判断存储哈希是否需要重新哈希（迭代次数与当前常量不一致时）。
 * 用于「登录成功后透明升级」：未来若上调迭代次数，旧账号会在下次登录时自动迁移。
 * 注意：旧版 310000 哈希无法在 Cloudflare 上验证（deriveBits 抛错），需走
 * scripts/reset-password.mjs 本地重设，本函数不覆盖该场景。
 */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored || !stored.startsWith(`${PBKDF2_PREFIX}:`)) return false;
  const parts = stored.split(':');
  if (parts.length !== 5) return false;
  const iterations = Number(parts[2]);
  return Number.isFinite(iterations) && iterations !== PBKDF2_ITERATIONS;
}

/** 恒定时间字符串比较（两串等长时按字节异或累加）。 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 为已通过校验的账号签发聊天会话 JWT。
 * payload 携带 sub / nickname，供 /api/me 等接口识别身份。
 */
export async function issueSessionToken(nickname: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: nickname,
      nickname,
      isAdmin: false,
      iat: now,
      exp: now + AUTH_CONFIG.JWT_EXPIRY,
    },
    secret
  );
}

function base64UrlEncode(data: Uint8Array): string {
  return btoa(Array.from(data, (b) => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJwt(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const key = await getSigningKey(secret);

  const encodedHeader = base64UrlEncode(textEncoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyJwt(
  token: string,
  secret: string
): Promise<{ valid: boolean; payload?: Record<string, unknown> }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;

    const key = await getSigningKey(secret);
    const sigArray = base64UrlDecode(signatureB64);

    const valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      key,
      new Uint8Array(sigArray),
      textEncoder.encode(signingInput)
    );

    if (!valid) return { valid: false };

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));

    if (payload.exp && (payload.exp as number) < Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

/** Timing-safe string comparison by comparing decoded Base64 representations.
 *
 * Both strings are base64-encoded, then compared char-by-char using XOR.
 * The XOR of character codes (plus length diff) accumulates into `result`;
 * only when result === 0 can we say the strings are equal.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encA = btoa(unescape(encodeURIComponent(a)));
  const encB = btoa(unescape(encodeURIComponent(b)));
  // Short-circuit if lengths differ — base64 output length is deterministic
  if (encA.length !== encB.length) return false;

  let result = 0;
  for (let i = 0; i < encA.length; i++) {
    result |= encA.charCodeAt(i) ^ encB.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 从请求 cookie 中解析出当前登录用户的昵称（会话身份）。
 * 供所有「变更类」接口做归属校验，防止越权（IDOR / 身份伪造）。
 *
 * @returns 昵称；未登录 / 会话无效 / 缺密钥时返回 null
 */
export async function getSessionUser(
  cookieHeader: string | null,
  cookieName: string = 'chat_session'
): Promise<string | null> {
  const secret = process.env.CHAT_JWT_SECRET;
  if (!secret) return null;
  const session = await extractSession(cookieHeader, secret, cookieName);
  if (!session.valid) return null;
  const nickname = session.payload?.nickname;
  return typeof nickname === 'string' && nickname ? nickname : null;
}

/** Extract and verify JWT from cookie header.
 *
 * @param cookieName 要读取的 cookie 名，默认 'chat_session'（普通聊天会话）。
 *                   管理后台使用独立的 'admin_session'，与聊天会话靠名字物理隔离，
 *                   两者都设在 path=/（因为 /api/admin/* 不以 /admin 为前缀，无法用 path 隔离）。
 */
export async function extractSession(
  cookieHeader: string | null,
  secret: string,
  cookieName: string = 'chat_session'
): Promise<{ valid: boolean; payload?: Record<string, unknown> }> {
  if (!cookieHeader) return { valid: false };

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  const sessionCookie = cookies.find((c) =>
    c.startsWith(`${cookieName}=`)
  );
  if (!sessionCookie) return { valid: false };

  const token = sessionCookie.split('=').slice(1).join('=');
  return verifyJwt(token, secret);
}
