'use client';

import { showError, createError, ErrorType } from './errorHandler';
import { UPLOAD_CONFIG } from '@/config';

// 存储服务类型
export type StorageServiceType = 'supabase' | 'imgbb';

// 存储服务配置
const storageConfig = {
  imgbb: {
    apiKey: process.env.NEXT_PUBLIC_IMGBB_API_KEY || '',
    apiUrl: 'https://api.imgbb.com/1/upload',
  },
};

// 根据文件大小选择存储服务
export const selectStorageService = (file: File): StorageServiceType => {
  const fileSize = file.size;
  
  // 检查文件类型
  const isImage = file.type.startsWith('image/');
  
  // 32MB以下的图片：使用 ImgBB（免费用户单张最大 32MB）
  if (fileSize < 32 * 1024 * 1024 && isImage && storageConfig.imgbb.apiKey) {
    return 'imgbb';
  }
  // 其他情况：使用 Supabase
  else {
    return 'supabase';
  }
};

// ImgBB 上传结果接口
export interface ImgBBUploadResult {
  url: string;
}

// 上传到 ImgBB
export const uploadToImgBB = async (
  file: File,
  updateProgress: (progress: number) => void
): Promise<ImgBBUploadResult> => {
  const { apiKey, apiUrl } = storageConfig.imgbb;
  
  if (!apiKey) {
    throw new Error('ImgBB API key 未配置');
  }
  
  const formData = new FormData();
  formData.append('image', file);
  formData.append('key', apiKey);
  
  // 模拟进度
  updateProgress(30);
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    body: formData,
  });
  
  updateProgress(80);
  
  if (!response.ok) {
    throw new Error(`ImgBB 上传失败: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(`ImgBB 上传失败: ${data.error?.message || '未知错误'}`);
  }
  
  updateProgress(100);
  return {
    url: data.data.url,
  };
};

// 统一上传函数
export const uploadFile = async (
  file: File,
  updateProgress: (progress: number) => void,
  roomId: string
): Promise<{ url: string }> => {
  const serviceType = selectStorageService(file);
  
  try {
    switch (serviceType) {
      case 'imgbb':
        return await uploadToImgBB(file, updateProgress);
      case 'supabase':
      default:
        // 保持原有的 Supabase 上传逻辑
        // 这里返回一个占位符，实际会在 useFileUpload 中处理
        throw new Error('Supabase 上传需要特殊处理');
    }
  } catch (error) {
    console.error(`上传到 ${serviceType} 失败:`, error);
    
    // 上传失败时，降级到 Supabase
    console.warn(`降级到 Supabase 上传`);
    throw error;
  }
};
