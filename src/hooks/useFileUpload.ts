'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import Compressor from 'compressorjs';
import { Message } from '@/types';
import { showError, createError, ErrorType } from '@/utils/errorHandler';
import { UPLOAD_CONFIG, STORAGE_CONFIG } from '@/config';
import { selectStorageService, uploadFile as uploadToService } from '@/utils/storageService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

interface UseFileUploadProps {
  user: string;
  roomId: string;
  sendMessage: (message: Message) => void;
}

interface UploadItem {
  progress: number;
  fileName: string;
}

export const useFileUpload = ({ user, roomId, sendMessage }: UseFileUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [uploadingMessages, setUploadingMessages] = useState<Map<string, UploadItem>>(new Map());

  // 图片压缩函数
  const compressImage = useCallback((file: File): Promise<File> => {
    return new Promise<File>((resolve, reject) => {
      new Compressor(file, {
        quality: UPLOAD_CONFIG.IMAGE_COMPRESSION.QUALITY,
        maxWidth: UPLOAD_CONFIG.IMAGE_COMPRESSION.MAX_WIDTH,
        maxHeight: UPLOAD_CONFIG.IMAGE_COMPRESSION.MAX_HEIGHT,
        success: (compressedFile) => {
          resolve(compressedFile as File);
        },
        error: (err) => {
          console.error('图片压缩失败:', err);
          // 压缩失败时使用原图
          resolve(file);
        },
      });
    });
  }, []);

  // 格式化文件大小
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  // 处理文件上传
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploading || !user.trim()) return;

    // 文件大小检查
    const maxFileSize = UPLOAD_CONFIG.MAX_FILE_SIZE;
    if (file.size > maxFileSize) {
      const error = createError(
        ErrorType.FILE_TOO_LARGE,
        `免费版上限 ${formatFileSize(maxFileSize)}，当前文件大小 ${formatFileSize(file.size)}。\n\n提示：图片会自动压缩，视频请选择较短的片段。`
      );
      showError(error);
      return;
    }
    
    // 文件类型检查
    const allowedTypes = UPLOAD_CONFIG.ALLOWED_FILE_TYPES;
    if (!allowedTypes.includes(file.type)) {
      const error = createError(
        ErrorType.INVALID_FILE_TYPE,
        '请上传图片（jpg、png、gif、webp）或视频（mp4、webm、ogg）。'
      );
      showError(error);
      return;
    }

    // 创建上传ID
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // 添加上传中的消息
    setUploadingMessages(prev => new Map(prev.set(uploadId, { progress: 0, fileName: file.name })));
    setUploading(true);

    // Supabase 上传函数（作为默认和降级方案）
    const uploadToSupabase = async (
      uploadFile: File,
      updateProgress: (progress: number) => void
    ): Promise<string> => {
      let processedFile = uploadFile;
      if (uploadFile.type.startsWith('image/')) {
        // 使用 compressorjs 压缩图片
        processedFile = await compressImage(uploadFile);
      }

      const fileExt = processedFile.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${roomId}/${fileName}`;

      // 上传文件到 Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(filePath, processedFile, {
          upsert: false
        });

      if (uploadError) throw uploadError;

      // 上传完成，准备获取签名URL
      updateProgress(80);
      
      const { data: signedData } = await supabase.storage
        .from('chat-media')
        .createSignedUrl(filePath, STORAGE_CONFIG.SIGNED_URL_EXPIRY);

      return signedData!.signedUrl;
    };

    try {
      // 上传进度更新函数
      const updateProgress = (newProgress: number) => {
        setUploadingMessages(prev => new Map(prev.set(uploadId, { progress: newProgress, fileName: file.name })));
      };

      // 初始进度 - 开始上传
      updateProgress(20);

      let fileUrl: string;
      const serviceType = selectStorageService(file);
      
      console.log(`选择存储服务: ${serviceType}`);
      
      try {
        // 尝试使用选定的存储服务
        if (serviceType === 'supabase') {
          // 使用 Supabase 上传
          fileUrl = await uploadToSupabase(file, updateProgress);
        } else {
          // 使用其他存储服务
          const uploadResult = await uploadToService(file, updateProgress, roomId);
          fileUrl = uploadResult.url;
        }
      } catch (serviceError) {
        console.error(`${serviceType} 上传失败，降级到 Supabase:`, serviceError);
        // 上传失败时，降级到 Supabase
        fileUrl = await uploadToSupabase(file, updateProgress);
      }

      // 完成所有操作
      updateProgress(100);

      const newMsg: Message = {
        user: user.trim(),
        type: file.type.startsWith('image/') ? 'image' : 'video',
        content: fileUrl,
        timestamp: new Date().toISOString(),
      };

      sendMessage(newMsg);
    } catch (err) {
      console.error('文件上传失败:', err);
      const error = createError(
        ErrorType.UPLOAD_FAILED,
        err instanceof Error ? err.message : '未知错误'
      );
      showError(error);
    } finally {
      // 移除上传中的消息
      setUploadingMessages(prev => {
        const newMap = new Map(prev);
        newMap.delete(uploadId);
        return newMap;
      });
      setUploading(false);
      e.target.value = '';
    }
  }, [uploading, user, roomId, sendMessage, compressImage, formatFileSize]);

  // 处理语音上传
  const handleVoiceUpload = useCallback(async (blob: Blob) => {
    if (uploading || !user.trim()) return;

    // 创建上传ID
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // 添加上传中的消息
    setUploadingMessages(prev => new Map(prev.set(uploadId, { progress: 0, fileName: 'voice-message.webm' })));
    setUploading(true);

    try {
      // 上传进度更新函数
      const updateProgress = (newProgress: number) => {
        setUploadingMessages(prev => new Map(prev.set(uploadId, { progress: newProgress, fileName: 'voice-message.webm' })));
      };

      // 初始进度 - 开始上传
      updateProgress(20);

      // 创建File对象
      const voiceFile = new File([blob], 'voice-message.webm', { type: 'audio/webm' });
      let fileUrl: string;

      // 直接使用Supabase上传语音文件
      const uploadToSupabase = async (
        uploadFile: File,
        updateProgress: (progress: number) => void
      ): Promise<string> => {
        const fileExt = uploadFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `${roomId}/${fileName}`;

        // 上传文件到 Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(filePath, uploadFile, {
            upsert: false
          });

        if (uploadError) throw uploadError;

        // 上传完成，准备获取签名URL
        updateProgress(80);
        
        const { data: signedData } = await supabase.storage
          .from('chat-media')
          .createSignedUrl(filePath, STORAGE_CONFIG.SIGNED_URL_EXPIRY);

        return signedData!.signedUrl;
      };

      // 上传语音文件
      fileUrl = await uploadToSupabase(voiceFile, updateProgress);

      // 完成所有操作
      updateProgress(100);

      const newMsg: Message = {
        user: user.trim(),
        type: 'voice',
        content: fileUrl,
        timestamp: new Date().toISOString(),
      };

      sendMessage(newMsg);
    } catch (err) {
      console.error('语音上传失败:', err);
      const error = createError(
        ErrorType.UPLOAD_FAILED,
        err instanceof Error ? err.message : '未知错误'
      );
      showError(error);
    } finally {
      // 移除上传中的消息
      setUploadingMessages(prev => {
        const newMap = new Map(prev);
        newMap.delete(uploadId);
        return newMap;
      });
      setUploading(false);
    }
  }, [uploading, user, roomId, sendMessage]);

  return {
    uploading,
    uploadingMessages,
    handleFileChange,
    handleVoiceUpload,
  };
};