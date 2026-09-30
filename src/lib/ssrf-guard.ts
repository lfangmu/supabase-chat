/**
 * SSRF Guard — 防止服务端请求伪造攻击
 *
 * 检查 URL 是否安全：
 * 1. 仅允许 http/https 协议
 * 2. 禁止内网 IP（10.x / 172.16-31.x / 192.168.x / 127.x / localhost）
 * 3. 禁止 IPv6 ULA 和 link-local 地址
 */

/** Check if a hostname is an internal/loopback address */
function isInternalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();

  // localhost variants
  if (lower === 'localhost' || lower === 'localhost.') return true;

  // IPv4 check
  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    // 正则已保证 4 组数字；默认值 -1 不会命中任何内网网段，因此不会误判为「内部地址」
    const [a = -1, b = -1] = ipv4Match.slice(1, 5).map(Number);
    // 10.x.x.x
    if (a === 10) return true;
    // 172.16-31.x.x
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.x.x
    if (a === 192 && b === 168) return true;
    // 127.x.x.x (loopback)
    if (a === 127) return true;
    // 0.x.x.x
    if (a === 0) return true;
    // 169.254.x.x (link-local)
    if (a === 169 && b === 254) return true;
    return false;
  }

  // IPv6 check — bracketed or plain
  const ipv6 = lower.replace(/^\[|\]$/g, '');
  if (ipv6.includes(':')) {
    // ::1 loopback
    if (ipv6 === '::1' || ipv6 === '::') return true;
    // fc00::/7 (ULA)
    if (/^f[cd][0-9a-f]{2}:/i.test(ipv6)) return true;
    // fe80::/10 (link-local)
    if (/^fe[89ab][0-9a-f]:/i.test(ipv6)) return true;
    return false;
  }

  return false;
}

/**
 * Check if a URL is safe to fetch from the server.
 * Returns true if the URL is safe (not internal), false otherwise.
 */
export function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // Check hostname against internal IP ranges
    if (isInternalHost(parsed.hostname)) {
      return false;
    }

    return true;
  } catch {
    // Invalid URL
    return false;
  }
}
