// 项目配置文件

// 存储桶配置
export const STORAGE_CONFIG = {
  BUCKET_NAME: 'chat-media',
  SIGNED_URL_EXPIRY: 86400, // 签名URL有效期（秒）
};

// 文件上传配置
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 最大文件大小（50MB）
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/ogg'],
  ALLOWED_VOICE_TYPES: ['audio/webm', 'audio/mp3', 'audio/ogg', 'audio/wav'],
  ALLOWED_FILE_TYPES: [
    ...['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    ...['video/mp4', 'video/webm', 'video/ogg'],
    ...['audio/webm', 'audio/mp3', 'audio/ogg', 'audio/wav'],
  ],
  IMAGE_COMPRESSION: {
    QUALITY: 0.8,
    MAX_WIDTH: 1920,
    MAX_HEIGHT: 1080,
  },
  VOICE_RECORDING: {
    MAX_DURATION: 60, // 最大录音时长（秒）
    MIME_TYPE: 'audio/webm', // 录音文件类型
  },
};

// 消息配置
export const MESSAGE_CONFIG = {
  PAGE_SIZE: 20, // 加载历史消息的页面大小
  MAX_MESSAGES: 1000, // 本地存储的最大消息数
};

// 认证配置
export const AUTH_CONFIG = {
  SESSION_KEY: 'chat-authenticated',
  PASSWORD_VERSION_KEY: 'chat-password-version',
  SHARE_LINK_EXPIRY: 24 * 60 * 60, // 分享链接有效期（秒）
  ENCRYPTION_KEY: 'supabase-chat-key', // 加密密钥（实际项目中应该从环境变量获取）
};

// 存储配置
export const STORAGE_CONFIG_KEYS = {
  MESSAGES_PREFIX: 'chat_messages_',
  NICKNAME_KEY: 'chat_nickname',
  THEME_KEY: 'chat_theme',
};

// 房间配置
export const ROOM_CONFIG = {
  DEFAULT_ROOM: 'default-room',
};

// API配置
export const API_CONFIG = {
  PASSWORD_VERSION_ENDPOINT: '/api/password-version',
  VERIFY_PASSWORD_ENDPOINT: '/api/verify-password',
};

// 样式配置
export const STYLE_CONFIG = {
  MESSAGE_BUBBLE_MAX_WIDTH: '80%',
  MESSAGE_BUBBLE_PADDING: '16px',
  MESSAGE_BUBBLE_BORDER_RADIUS: '16px',
};
