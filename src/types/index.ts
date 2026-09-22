// 消息类型
export interface Message {
  user: string;
  type: 'text' | 'image' | 'video' | 'voice';
  content: string;
  timestamp: string;
}

// 文本消息类型
export interface TextMessage extends Message {
  type: 'text';
  content: string;
}

// 图片消息类型
export interface ImageMessage extends Message {
  type: 'image';
  content: string; // 图片URL
}

// 视频消息类型
export interface VideoMessage extends Message {
  type: 'video';
  content: string; // 视频URL
}

// 语音消息类型
export interface VoiceMessage extends Message {
  type: 'voice';
  content: string; // 语音URL
}

// 上传进度项类型
export interface UploadItem {
  progress: number;
  fileName: string;
}

// 聊天状态
export interface ChatState {
  user: string;
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

// 分享链接参数类型
export interface ShareLinkParams {
  roomId?: string;
  password: string;
  timestamp: number;
}

// 消息输入事件
export interface MessageInputEvent {
  target: {
    value: string;
  };
}

// 键盘事件
export interface KeyboardEvent {
  key: string;
  preventDefault: () => void;
}

// 文件上传事件
export interface FileChangeEvent {
  target: {
    files: FileList | null;
    value: string;
  };
}

// 类型守卫函数：检查是否为文本消息
export const isTextMessage = (message: Message): message is TextMessage => {
  return message.type === 'text';
};

// 类型守卫函数：检查是否为图片消息
export const isImageMessage = (message: Message): message is ImageMessage => {
  return message.type === 'image';
};

// 类型守卫函数：检查是否为视频消息
export const isVideoMessage = (message: Message): message is VideoMessage => {
  return message.type === 'video';
};

// 类型守卫函数：检查是否为语音消息
export const isVoiceMessage = (message: Message): message is VoiceMessage => {
  return message.type === 'voice';
};

// 类型守卫函数：检查是否为上传项
export const isUploadItem = (item: any): item is UploadItem => {
  return typeof item === 'object' && 
    typeof item.progress === 'number' && 
    typeof item.fileName === 'string';
};
