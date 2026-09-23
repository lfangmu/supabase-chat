// 消息发送状态
export type SendStatus = 'sending' | 'sent' | 'failed';

/** 房间信息 */
export interface Room {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  type?: 'public' | 'dm';
  last_message_at?: string | null;
  last_message_content?: string | null;
  last_message_type?: string | null;
  last_message_user?: string | null;
}

/** 私聊房间（好友单聊） */
export interface DMRoom extends Room {
  type: 'dm';
  participants: [string, string];
  otherUser: string;
}

// ============ REQ-005: 日期分隔线虚拟列表 ============

/** 虚拟列表混合项 */
export type VirtualListItem =
  | { type: 'separator'; date: string; key: string }
  | { type: 'message'; message: Message; originalIndex: number; key: string };

// ============ 消息类型（扩展） ============

// 消息类型
export interface Message {
  id: string;
  user: string;
  type: 'text' | 'image' | 'video' | 'voice' | 'file';
  content: string;
  timestamp: string;
  quoteId?: string;
  quote?: {
    user: string;
    type: 'text' | 'image' | 'video' | 'voice' | 'file';
    content: string;
  };
  sendStatus?: SendStatus;
  edited_at?: string | null;
  // 撤回时间（软删除）：非空表示已被发送者撤回
  withdrawn_at?: string | null;
  // REQ-001: 表情回应（由 reactions API 聚合到每条消息）
  reactions?: Reaction[];
  // 客户端派生：本条消息是否已被对方已读（仅私聊展示「已读」）
  readByOther?: boolean;
  // REQ-010: 文件元数据
  file_name?: string | null;
  file_size?: number | null;
  file_mime?: string | null;
}

// REQ-001: 表情回应（emoji reaction）
export interface Reaction {
  id: string;
  message_id: string;
  user: string;
  emoji: string;
  created_at: string;
}

// 文本消息类型
export interface TextMessage extends Message {
  type: 'text';
  content: string;
}

// 图片消息类型
export interface ImageMessage extends Message {
  type: 'image';
  content: string;
}

// 视频消息类型
export interface VideoMessage extends Message {
  type: 'video';
  content: string;
}

// 语音消息类型
export interface VoiceMessage extends Message {
  type: 'voice';
  content: string;
}

// 文件消息类型
export interface FileMessageData extends Message {
  type: 'file';
  content: string;
  file_name: string;
  file_size: number;
  file_mime: string;
}

// 上传进度项类型
export interface UploadItem {
  progress: number;
  fileName: string;
}

// 聊天状态
export interface ChatState {
  user: string;
  savedNickname: string | null;
  showNicknameInput: boolean;
  message: string;
  messages: Message[];
  roomId: string;
  uploading: boolean;
  uploadingMessages: Map<string, UploadItem>;
  loadingMore: boolean;
  hasMore: boolean;
}

// 认证状态
export interface AuthState {
  isAuthenticated: boolean;
  passwordVersion: string | null;
}

// 全局搜索过滤条件
export interface GlobalSearchFilters {
  sender?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
}

// 全局搜索结果项（包含房间信息）
export interface GlobalSearchResult extends Message {
  room_id?: string;
  room_name?: string;
}

// 聊天设置
export interface RoomChatSetting {
  pinned: boolean;
  pinnedAt?: string;
  muted: boolean;
}

export type ChatSettingsMap = Record<string, RoomChatSetting>;

// ============ 好友 / 群成员 / 已读 ============

/** 好友关系状态 */
export type FriendStatus = 'pending' | 'accepted' | 'blocked';

/** 好友全景（来自 /api/friends） */
export interface FriendsData {
  friends: { nickname: string; avatar: string | null; signature: string }[];
  incoming: { nickname: string; created_at: string }[];
  outgoing: { nickname: string; created_at: string }[];
  blocked: string[];
}

/** 群成员（来自 /api/rooms/members?roomId=） */
export interface RoomMember {
  nickname: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
  avatar: string | null;
  signature: string;
}

/** 用户资料（来自 /api/users） */
export interface UserProfile {
  nickname: string;
  avatar: string | null;
  signature: string;
  created_at: string | null;
  last_active_at: string | null;
}

// 类型守卫函数
export const isTextMessage = (message: Message): message is TextMessage =>
  message.type === 'text';

export const isImageMessage = (message: Message): message is ImageMessage =>
  message.type === 'image';

export const isVideoMessage = (message: Message): message is VideoMessage =>
  message.type === 'video';

export const isVoiceMessage = (message: Message): message is VoiceMessage =>
  message.type === 'voice';

export const isFileMessage = (message: Message): message is FileMessageData =>
  message.type === 'file';

export const isUploadItem = (item: unknown): item is UploadItem =>
  typeof item === 'object' && item !== null &&
  typeof (item as UploadItem).progress === 'number' &&
  typeof (item as UploadItem).fileName === 'string';
