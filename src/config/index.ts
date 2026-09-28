// 存储桶配置
export const STORAGE_CONFIG = {
  BUCKET_NAME: 'chat-media',
  SIGNED_URL_EXPIRY: 86400,
};

// 文件上传配置
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/ogg'],
  ALLOWED_VOICE_TYPES: ['audio/webm', 'audio/mp3', 'audio/ogg', 'audio/wav'],
  ALLOWED_FILE_TYPES: [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg',
    'audio/webm', 'audio/mp3', 'audio/ogg', 'audio/wav',
    // REQ-010: 文档类型
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // REQ-010: 压缩文件
    'application/zip',
    'application/x-rar-compressed',
    // REQ-010: 文本类型
    'text/plain',
    'text/csv',
    'application/json',
  ],
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
  MAX_MESSAGES: 100_000, // ~100K messages in cache to prevent pagination gaps
  MAX_PROCESSED_IDS: 10_000, // 去重 Set 上限，防止内存泄漏
  MAX_CONTENT_LENGTH: 10000,
};

// 消息缓存版本：每次执行破坏性迁移（如 TRUNCATE public.messages / 换库 / 改 schema）
// 后把这个数字 +1，前端在下次加载时会清掉旧的 localStorage 消息缓存，
// 避免「服务端库已清空，但本地还显示 7月31日 这类旧消息」的割裂。
// 当前因 00020_auth_uuid_identity 迁移 TRUNCATE 了 messages，故从 1 提到 2。
export const MESSAGE_CACHE_VERSION = 2;

// 认证配置
export const AUTH_CONFIG = {
  SESSION_COOKIE: 'chat_session',
  PASSWORD_VERSION_INTERVAL: 60_000, // 60秒
  JWT_EXPIRY: 30 * 24 * 60 * 60,   // 30天（秒）
};

// 存储配置
export const STORAGE_CONFIG_KEYS = {
  MESSAGES_PREFIX: 'chat_messages_v1_',
  // 旧版「昵称」存储键已随 Supabase Auth 迁移移除（身份改用 auth.uid()，展示名来自 public.users.display_name）
  THEME_KEY: 'chat_theme',
  // REQ-004: 草稿
  DRAFT_PREFIX: 'chat_draft_',
  // REQ-007: @提及红点
  MENTIONED_ROOMS_KEY: 'chat_mentioned_rooms',
  // 聊天设置（置顶、免打扰）
  CHAT_SETTINGS_KEY: 'chat_settings',
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
  USER_SEARCH_ENDPOINT: '/api/users',
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

// 样式配置
export const STYLE_CONFIG = {
  MESSAGE_BUBBLE_MAX_WIDTH: '80%',
  MESSAGE_BUBBLE_PADDING: '16px',
  MESSAGE_BUBBLE_BORDER_RADIUS: '16px',
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
