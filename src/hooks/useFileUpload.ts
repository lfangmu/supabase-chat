'use client';

import { useState, useCallback } from 'react';
import Compressor from 'compressorjs';
import { Message } from '@/types';
import { showError, createError, ErrorType } from '@/utils/errorHandler';
import { generateId } from '@/utils/id';
import { UPLOAD_CONFIG, API_CONFIG } from '@/config';
import { isDocumentMimeType } from '@/lib/file-types';

interface UseFileUploadProps {
  /** 展示名（写入 messages.user，仅展示） */
  user: string;
  /** 发送者 Supabase Auth UUID（写入 messages.user_id，身份键） */
  userId: string;
  roomId: string;
  sendMessage: (message: Message) => void;
}

interface UploadItem {
  progress: number;
  fileName: string;
}

export const useFileUpload = ({ user, userId, roomId, sendMessage }: UseFileUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [uploadingMessages, setUploadingMessages] = useState<Map<string, UploadItem>>(new Map());

  const compressImage = useCallback((file: File): Promise<File> => {
    return new Promise<File>((resolve) => {
      new Compressor(file, {
        quality: UPLOAD_CONFIG.IMAGE_COMPRESSION.QUALITY,
        maxWidth: UPLOAD_CONFIG.IMAGE_COMPRESSION.MAX_WIDTH,
        maxHeight: UPLOAD_CONFIG.IMAGE_COMPRESSION.MAX_HEIGHT,
        success: (compressedFile) => resolve(compressedFile as File),
        error: (err) => {
          console.error('图片压缩失败:', err);
          resolve(file);
        },
      });
    });
  }, []);

  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  const updateProgress = useCallback(
    (uploadId: string, progress: number, fileName: string) => {
      setUploadingMessages((prev) => {
        const next = new Map(prev);
        next.set(uploadId, { progress, fileName });
        return next;
      });
    },
    []
  );

  const uploadToSupabase = useCallback(
    async (uploadFile: File, onProgress: (p: number) => void): Promise<string> => {
      let processedFile = uploadFile;
      // Only compress images, not other file types
      if (uploadFile.type.startsWith('image/')) {
        processedFile = await compressImage(uploadFile);
      }

      const formData = new FormData();
      formData.append('file', processedFile);
      formData.append('roomId', roomId);

      onProgress(60);

      const res = await fetch(API_CONFIG.UPLOAD_MEDIA_ENDPOINT, {
        method: 'POST',
        body: formData,
      });

      onProgress(80);

      const data = await res.json();
      if (!data.success || !data.filePath) {
        throw new Error(data.message || '上传失败');
      }

      // Return the storage path (not a signed URL).
      // Signed URLs are generated on-the-fly by useSignedUrl hook.
      return data.filePath;
    },
    [roomId, compressImage]
  );

  const uploadToImgBB = useCallback(
    async (uploadFile: File, onProgress: (p: number) => void): Promise<string> => {
      const formData = new FormData();
      formData.append('image', uploadFile);
      // P1-7：服务端要求携带房间上下文（否则该端点会沦为登录用户可用的免费图床）
      formData.append('roomId', roomId);
      onProgress(30);

      const response = await fetch(API_CONFIG.UPLOAD_PROXY_ENDPOINT, {
        method: 'POST',
        body: formData,
      });

      onProgress(80);

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || 'ImgBB 上传失败');
      }
      onProgress(100);
      return data.url;
    },
    [roomId]
  );

  /**
   * 核心上传流程：接收一个 File，完成校验 → 上传 → 发送消息。
   *
   * P3 重构：从原 `handleFileChange(e: ChangeEvent)` 里抽出。
   * 此前「粘贴 / 拖拽」路径需要伪造一个 `ChangeEvent`（`{target, currentTarget} as unknown as
   * React.ChangeEvent<HTMLInputElement>` 双重断言）才能复用这段逻辑 —— 既脆弱又难读。
   * 现在直接调用本函数即可，调用方无需构造假事件。
   */
  const uploadFile = useCallback(
    async (file: File) => {
      if (!file || uploading || !user.trim()) return;

      if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE) {
        showError(
          createError(
            ErrorType.FILE_TOO_LARGE,
            `上限 ${formatFileSize(UPLOAD_CONFIG.MAX_FILE_SIZE)}，当前 ${formatFileSize(file.size)}`
          )
        );
        return;
      }

      if (!UPLOAD_CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
        showError(
          createError(ErrorType.INVALID_FILE_TYPE, '请上传支持的文件类型。')
        );
        return;
      }

      const uploadId = `upload-${generateId()}`;
      const onProgress = (p: number) => updateProgress(uploadId, p, file.name);

      setUploadingMessages((prev) => {
        const next = new Map(prev);
        next.set(uploadId, { progress: 0, fileName: file.name });
        return next;
      });
      setUploading(true);

      try {
        onProgress(20);

        let fileUrl: string;
        const isImage = file.type.startsWith('image/');
        const isAudio = file.type.startsWith('audio/');
        const isGenericFile = isDocumentMimeType(file.type);

        // Images < 32MB go to ImgBB (free, effectively unlimited) to save Supabase
        // free-tier 1GB storage; video/audio/large images/files go to Supabase.
        // Historical ImgBB URLs keep displaying via useSignedUrl's http-prefix passthrough.
        if (isImage && file.size < 32 * 1024 * 1024) {
          try {
            const compressed = await compressImage(file);
            fileUrl = await uploadToImgBB(compressed, onProgress);
          } catch (err) {
            console.warn('ImgBB upload failed, falling back to Supabase:', err);
            fileUrl = await uploadToSupabase(file, onProgress);
          }
        } else {
          fileUrl = await uploadToSupabase(file, onProgress);
        }

        onProgress(100);

        // REQ-010: Construct message with appropriate type
        const newMsg: Message = {
          id: generateId(),
          user: user.trim(),
          userId,
          type: isImage ? 'image' : isAudio ? 'voice' : isGenericFile ? 'file' : 'video',
          content: fileUrl,
          timestamp: new Date().toISOString(),
        };

        // REQ-010: Add file metadata for file-type messages
        if (isGenericFile) {
          newMsg.file_name = file.name;
          newMsg.file_size = file.size;
          newMsg.file_mime = file.type;
        }

        sendMessage(newMsg);
      } catch (err) {
        console.error('文件上传失败:', err);
        showError(
          createError(ErrorType.UPLOAD_FAILED, err instanceof Error ? err.message : '未知错误')
        );
      } finally {
        setUploadingMessages((prev) => {
          const next = new Map(prev);
          next.delete(uploadId);
          return next;
        });
        setUploading(false);
      }
    },
    [uploading, user, userId, sendMessage, compressImage, formatFileSize, updateProgress, uploadToSupabase, uploadToImgBB]
  );

  /** `<input type="file">` 的 onChange 包装：取第一个文件后交给 `uploadFile`。 */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // 先重置 value，允许「连续两次选同一个文件」都能触发 change
      e.target.value = '';
      void uploadFile(file);
    },
    [uploadFile]
  );

  const handleVoiceUpload = useCallback(
    async (blob: Blob) => {
      if (uploading || !user.trim()) return;

      const uploadId = `upload-${generateId()}`;
      const onProgress = (p: number) => updateProgress(uploadId, p, 'voice-message.webm');

      setUploadingMessages((prev) => {
        const next = new Map(prev);
        next.set(uploadId, { progress: 0, fileName: 'voice-message.webm' });
        return next;
      });
      setUploading(true);

      try {
        onProgress(20);
        const voiceFile = new File([blob], 'voice-message.webm', { type: 'audio/webm' });
        const fileUrl = await uploadToSupabase(voiceFile, onProgress);
        onProgress(100);

        const newMsg: Message = {
          id: generateId(),
          user: user.trim(),
          userId,
          type: 'voice',
          content: fileUrl,
          timestamp: new Date().toISOString(),
        };

        sendMessage(newMsg);
      } catch (err) {
        console.error('语音上传失败:', err);
        showError(
          createError(ErrorType.UPLOAD_FAILED, err instanceof Error ? err.message : '未知错误')
        );
      } finally {
        setUploadingMessages((prev) => {
          const next = new Map(prev);
          next.delete(uploadId);
          return next;
        });
        setUploading(false);
      }
    },
    [uploading, user, userId, sendMessage, updateProgress, uploadToSupabase]
  );

  return {
    uploading,
    uploadingMessages,
    handleFileChange,
    handleVoiceUpload,
    /** 供粘贴 / 拖拽路径直接投递文件（无需伪造 ChangeEvent） */
    uploadFile,
    formatFileSize,
  };
};
