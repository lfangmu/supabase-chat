// 存储桶配置
import {
  ALLOWED_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  ALLOWED_VOICE_MIME_TYPES,
} from '@/lib/file-types';

export const STORAGE_CONFIG = {
  BUCKET_NAME: 'chat-media',
  SIGNED_URL_EXPIRY: 86400,
};

// 文件上传配置
//
// P2-25：文件类型白名单此前在本文件、`src/hooks/useFileUpload.ts`、
// `src/app/api/upload-media/route.ts` 各抄一份（需手工同步，改一处漏两处就会出现
// 「前端接受、服务端拒绝」）。现统一收敛到 `src/lib/file-types.ts` 这一唯一权威来源，
// 服务端另有魔数（magic bytes）嗅探，见该模块与 P1-6 的修复说明。
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  ALLOWED_IMAGE_TYPES: [...ALLOWED_IMAGE_MIME_TYPES],
  ALLOWED_VIDEO_TYPES: [...ALLOWED_VIDEO_MIME_TYPES],
  ALLOWED_VOICE_TYPES: [...ALLOWED_VOICE_MIME_TYPES],
  ALLOWED_FILE_TYPES: [...ALLOWED_MIME_TYPES],
  IMAGE_COMPRESSION: {
    QUALITY: 0.8,
    MAX_WIDTH: 1920,
    MAX_HEIGHT: 1080,
  },
  VOICE_RECORDING: {
    MAX_DURATION: 60,
    MIME_TYPE: 'audio/webm',
  },
};

// 消息配置
export const MESSAGE_CONFIG = {
  PAGE_SIZE: 20,
  /**
   * 单房间本地消息缓存的**条数**上限。
   *
   * P2-21：原值 100_000 —— 而 `cacheUtils.safeSetCache` 会把整个数组 `JSON.stringify`
   * 后写 localStorage（通常仅 5–10MB 配额）。10 万条消息**必然超配额抛错**，
   * 然后回退只写 50 条。结果是「每次都白白做一次巨型同步序列化，大缓存永不生效」。
   * 现在降到与字节预算相称的量级（另见 `MAX_CACHE_BYTES`）。
   */
  MAX_MESSAGES: 500,
  /**
   * 单房间本地消息缓存的**字节预算**（估算值）。
   * 与 `MAX_MESSAGES` 取先到者，双约束保证不会撞爆 localStorage 配额。
   */
  MAX_CACHE_BYTES: 2 * 1024 * 1024, // 2MB / 房间
  MAX_PROCESSED_IDS: 10_000, // 去重 Set 上限，防止内存泄漏
  MAX_CONTENT_LENGTH: 10000,
};

// 消息缓存版本：每次执行破坏性迁移（如 TRUNCATE public.messages / 换库 / 改 schema）
// 后把这个数字 +1，前端在下次加载时会清掉旧的 localStorage 消息缓存，
// 避免「服务端库已清空，但本地还显示 7月31日 这类旧消息」的割裂。
// 当前因 00020_auth_uuid_identity 迁移 TRUNCATE 了 messages，故从 1 提到 2。
export const MESSAGE_CACHE_VERSION = 2;

// 存储配置
export const STORAGE_CONFIG_KEYS = {
  MESSAGES_PREFIX: 'chat_messages_v1_',
  // 旧版「昵称」存储键已随 Supabase Auth 迁移移除（身份改用 auth.uid()，展示名来自 public.users.display_name）
  // 主题键由 next-themes 自行管理（attribute="class" + 自带 storageKey），此处不再重复声明。
  // REQ-004: 草稿
  DRAFT_PREFIX: 'chat_draft_',
  // REQ-007: @提及红点（唯一来源，utils/notifications.ts 从这里取）
  MENTIONED_ROOMS_KEY: 'chat_mentioned_rooms',
  // 已删除消息
  DELETED_MESSAGES_KEY: 'chat_deleted_messages',
  // 已「清空聊天记录」的房间：{ [roomId]: ISO 时间戳 }，早于该时间的消息在本机隐藏
  CLEARED_ROOMS_KEY: 'chat_cleared_rooms',
  // 消息缓存版本键：与 MESSAGE_CACHE_VERSION 对齐，不匹配时清空 MESSAGES_PREFIX* 缓存
  MESSAGE_CACHE_VERSION_KEY: 'chat_messages_cache_version',
};

// 房间配置
export const ROOM_CONFIG = {
  DEFAULT_ROOM: 'default-room',
};

// 私聊配置
export const DM_CONFIG = {
  // DM 房间 ID 前缀
  ID_PREFIX: 'dm:',
};

// API 配置
export const API_CONFIG = {
  // 当前会话资料（Supabase Auth 登录后取展示名 / 头像 / 角色）
  AUTH_ME_ENDPOINT: '/api/me',
  MESSAGES_ENDPOINT: '/api/messages',
  UPLOAD_MEDIA_ENDPOINT: '/api/upload-media',
  UPLOAD_PROXY_ENDPOINT: '/api/upload-proxy',
  // 好友 / 私聊
  DM_LIST_ENDPOINT: '/api/dm-list',
  USERS_ENDPOINT: '/api/users',
  FRIENDS_ENDPOINT: '/api/friends',
  ROOM_MEMBERS_ENDPOINT: '/api/rooms/members',
  // 房间发现对账：返回当前用户「服务端记录的」全部房间 ID（只增不删地补进本地已加入列表）
  ROOMS_MINE_ENDPOINT: '/api/rooms/mine',
  MESSAGE_READ_ENDPOINT: '/api/messages/read',
  // 管理后台（Supabase Auth 登录后由 middleware 按 users.role='admin' 放行）
  ADMIN_ROOMS_ENDPOINT: '/api/admin/rooms',
  ADMIN_MESSAGES_ENDPOINT: '/api/admin/messages',
  ADMIN_AUDIT_LOGS_ENDPOINT: '/api/admin/audit-logs',
};

// ============ REQ-004: 草稿配置 ============
export const DRAFT_CONFIG = {
  // 防抖延迟（毫秒）
  DEBOUNCE_DELAY: 500,
  // 过期时间：7 天（毫秒）
  EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
  // 最大字符数
  MAX_LENGTH: 10000,
};

// ============ REQ-003: 全局搜索配置 ============
export const SEARCH_CONFIG = {
  // 防抖延迟（毫秒）
  DEBOUNCE_DELAY: 300,
  // 结果上限
  MAX_RESULTS: 100,
};
