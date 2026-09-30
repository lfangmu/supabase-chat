/**
 * 共享输入校验工具（CODE-REVIEW-2026-09-28.md P2-4 / P3「房间 ID 校验正则不一致」）。
 *
 * 背景：此前同一类房间 id 在不同接口用了两套范围不同的正则 ——
 *   `\u4e00-\u9fff`（U+4E00–U+9FFF，完整 CJK 统一表意文字）
 *   `一-龥`（U+4E00–U+9FA5，少了最后 90 个码位）
 * 导致同一 id 在不同接口接受度不同（`龦`…`龿` 区间会被部分接口拒绝）。
 * 这里统一为唯一实现，所有 API 路由引用本模块。
 */

/** 房间 id 允许：字母 / 数字 / CJK 统一表意文字 / `_` `:` `-`，最长 200。 */
export const ROOM_ID_MAX_LENGTH = 200;
const ROOM_ID_RE = /^[a-zA-Z0-9\u4e00-\u9fff_:-]+$/;

/** 消息 id：本项目由客户端生成（`utils/id.ts`）或服务端 UUID，仅允许 URL 安全字符。 */
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]+$/;
export const MESSAGE_ID_MAX_LENGTH = 100;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 房间 id 校验（统一版，替代散落各处的重复正则）。 */
export function isValidRoomId(roomId: unknown): roomId is string {
  return (
    typeof roomId === 'string' &&
    roomId.length > 0 &&
    roomId.length <= ROOM_ID_MAX_LENGTH &&
    ROOM_ID_RE.test(roomId)
  );
}

/** 消息 id 校验（防超长 id 撑大请求体 / 索引）。 */
export function isValidMessageId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MESSAGE_ID_MAX_LENGTH &&
    MESSAGE_ID_RE.test(id)
  );
}

/** Supabase Auth UUID 校验。 */
export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * 客户端时间戳校验：必须是**可解析**的 ISO 8601 且处于合理区间。
 *
 * 为什么必须校验：`messages.timestamp` 由客户端提交（见 P2-4），
 * 此前完全未校验 —— 攻击者可写入 `timestamp: "abc"` 破坏排序 / 分页游标，
 * 也会让 P2-5 的「2 分钟撤回限制」因 `NaN` 而被整体跳过。
 *
 * 允许区间：过去 10 年内 ~ 未来 5 分钟内（容忍客户端时钟漂移）。
 */
export function isValidClientTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return false;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  const TEN_YEARS = 10 * 365 * 24 * 60 * 60 * 1000;
  const FIVE_MINUTES = 5 * 60 * 1000;
  return t > now - TEN_YEARS && t < now + FIVE_MINUTES;
}

/** 序列化后的 JSON 负载体积上限（字符数），用于 `quote` / `forwarded_from` 等自由字段。 */
export const MAX_JSON_PAYLOAD_CHARS = 4096;

/**
 * 取出「会被字符串拼接进 PostgREST 过滤器表达式」的 UUID（P3 防御纵深）。
 *
 * `friends` / `dm-list` / `search` 都写过 `.or(\`user_a.eq.${actor},...\`)` 这类拼接。
 * actor 目前总是服务端从 token 解出的 UUID，因此**当前不可利用**；但一旦上游实现变化
 * 让用户可控内容流进来，一个逗号或括号就能越出过滤值（典型的 PostgREST 过滤注入）。
 * 这里显式断言：不合规直接抛错（由路由的 try/catch 兜成 500），而不是静默拼出畸形过滤器。
 */
export function requireUuidForFilter(value: unknown): string {
  if (!isValidUuid(value)) {
    throw new Error('invalid uuid used in PostgREST filter interpolation');
  }
  return value;
}

/**
 * 转义 PostgREST `LIKE` / `ILIKE` 模式里的通配符（P3）。
 *
 * 用户输入的 `%` / `_` 若不转义会被当成通配符：搜「a%b」会变成「以 a 开头、b 结尾」，
 * 搜「_」则等价于「任意单字符」→ 等于把全表拉回来。反斜杠本身也要先转义。
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** 校验「可选 JSON 字段」的体积（防止任意大 JSON 撑大 DB 行）。 */
export function isWithinJsonBudget(value: unknown, max = MAX_JSON_PAYLOAD_CHARS): boolean {
  if (value === undefined || value === null) return true;
  try {
    return JSON.stringify(value).length <= max;
  } catch {
    return false;
  }
}
