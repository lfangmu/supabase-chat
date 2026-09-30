import { toast } from 'sonner';

// 错误类型定义
export enum ErrorType {
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  MESSAGE_SEND_FAILED = 'MESSAGE_SEND_FAILED',
  PASSWORD_ERROR = 'PASSWORD_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// 错误接口
export interface AppError {
  type: ErrorType;
  message: string;
  details?: string;
}

// 错误消息映射
const errorMessages: Record<ErrorType, string> = {
  [ErrorType.UPLOAD_FAILED]: '文件上传失败，请重试',
  [ErrorType.NETWORK_ERROR]: '网络连接失败，请检查网络设置',
  [ErrorType.FILE_TOO_LARGE]: '文件过大，请选择较小的文件',
  [ErrorType.INVALID_FILE_TYPE]: '不支持的文件类型',
  [ErrorType.MESSAGE_SEND_FAILED]: '消息发送失败，请重试',
  [ErrorType.PASSWORD_ERROR]: '密码错误或已过期',
  [ErrorType.UNKNOWN_ERROR]: '发生未知错误，请重试',
};

// 创建错误对象
export const createError = (type: ErrorType, details?: string): AppError => {
  return {
    type,
    message: errorMessages[type],
    details,
  };
};

// 显示错误提示
export const showError = (error: AppError | string) => {
  // 调用方直接传入字符串时，该字符串本身就是面向用户的友好文案，原样展示
  if (typeof error === 'string') {
    toast.error(error);
    return;
  }

  // AppError：只向用户展示友好的 message；技术细节（如原始 error.message）仅记录到
  // 控制台，避免把后端/网络内部信息暴露给普通用户
  toast.error(error.message);
  if (error.details) {
    console.error('[error]', error.details);
  }
};

// 显示成功提示
export const showSuccess = (message: string) => {
  toast.success(message);
};
