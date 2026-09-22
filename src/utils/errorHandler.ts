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
  const errorObj = typeof error === 'string' 
    ? createError(ErrorType.UNKNOWN_ERROR, error) 
    : error;
  
  // 这里可以根据需要替换为更友好的错误提示组件
  // 例如使用 toast 通知或模态框
  alert(`${errorObj.message}${errorObj.details ? `\n\n详情：${errorObj.details}` : ''}`);
};

// 显示成功提示
export const showSuccess = (message: string) => {
  // 这里可以根据需要替换为更友好的成功提示组件
  alert(message);
};

// 处理网络错误
export const handleNetworkError = (error: any) => {
  console.error('网络错误:', error);
  const errorMessage = error.message || '网络连接失败';
  showError(createError(ErrorType.NETWORK_ERROR, errorMessage));
};

// 处理上传错误
export const handleUploadError = (error: any) => {
  console.error('上传错误:', error);
  const errorMessage = error.message || '上传失败';
  showError(createError(ErrorType.UPLOAD_FAILED, errorMessage));
};

// 处理消息发送错误
export const handleMessageSendError = (error: any) => {
  console.error('消息发送错误:', error);
  const errorMessage = error.message || '发送失败';
  showError(createError(ErrorType.MESSAGE_SEND_FAILED, errorMessage));
};