'use client';

import React from 'react';
import {
  FileText, FileSpreadsheet, File as FileIcon, Presentation,
  Archive, FileCode, Download, Loader2,
} from 'lucide-react';
import { Message } from '@/types';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { wechatSelfBubble, wechatOtherBubble, wechatSelfSubtle } from '@/utils/chatStyles';

interface FileMessageProps {
  /** The file message */
  message: Message;
  /** Whether this is the current user's own message */
  isSelf: boolean;
}

/** Get file icon based on MIME type */
function getFileIcon(mime: string | null | undefined) {
  if (!mime) return <FileIcon className="w-8 h-8" />;

  if (mime.startsWith('image/')) return <FileText className="w-8 h-8" />;
  if (mime === 'application/pdf') return <FileText className="w-8 h-8" />;
  if (mime.includes('word')) return <FileText className="w-8 h-8" />;
  if (mime.includes('sheet') || mime.includes('excel')) return <FileSpreadsheet className="w-8 h-8" />;
  if (mime.includes('presentation') || mime.includes('powerpoint')) return <Presentation className="w-8 h-8" />;
  if (mime === 'application/zip' || mime === 'application/x-rar-compressed' || mime === 'application/x-7z-compressed') return <Archive className="w-8 h-8" />;
  if (mime.startsWith('text/') || mime === 'application/json') return <FileCode className="w-8 h-8" />;

  return <FileIcon className="w-8 h-8" />;
}

/** Format file size to human-readable string */
function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Get file extension from filename */
function getFileExtension(fileName: string | null | undefined): string {
  if (!fileName) return '';
  const parts = fileName.split('.');
  if (parts.length < 2) return '';
  return (parts[parts.length - 1] ?? '').toUpperCase();
}

/**
 * REQ-010: File message bubble — displays file metadata (icon, name, size)
 * with a download button. Uses signed URL for secure download.
 */
const FileMessage: React.FC<FileMessageProps> = React.memo(({ message, isSelf }) => {
  const resolvedUrl = useSignedUrl(message.content);
  const fileName = message.file_name || '未知文件';
  const fileSize = formatFileSize(message.file_size);
  const fileExt = getFileExtension(message.file_name);
  const [isDownloading, setIsDownloading] = React.useState(false);

  const handleDownload = React.useCallback(async () => {
    if (!resolvedUrl) return;
    setIsDownloading(true);
    try {
      const response = await fetch(resolvedUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      }, 100);
    } catch {
      // Fallback: direct download
      const link = document.createElement('a');
      link.href = resolvedUrl;
      link.download = fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setIsDownloading(false);
    }
  }, [resolvedUrl, fileName]);

  return (
    <div
      className={`inline-flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all duration-200 max-w-[280px] ${
        isSelf ? wechatSelfBubble : wechatOtherBubble
      }`}
    >
      {/* File type icon */}
      <div
        className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${
          isSelf ? wechatSelfSubtle : 'bg-muted text-muted-foreground'
        }`}
      >
        {getFileIcon(message.file_mime)}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={fileName}>
          {fileName}
        </div>
        <div className={`text-xs flex items-center gap-1.5 mt-0.5 ${
          isSelf ? 'text-[#1f1f1f]/70 dark:text-white/70' : 'text-muted-foreground'
        }`}>
          {fileExt && <span className="font-mono">{fileExt}</span>}
          {fileExt && fileSize && <span>·</span>}
          {fileSize && <span>{fileSize}</span>}
        </div>
      </div>

      {/* Download button */}
      <button
        onClick={handleDownload}
        disabled={!resolvedUrl || isDownloading}
        className={`flex-shrink-0 p-2 rounded-lg transition-colors ${
          isSelf
            ? 'hover:bg-black/10 text-[#1f1f1f]/80 dark:text-white/80 hover:text-[#1f1f1f] dark:hover:text-white'
            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        aria-label={`下载文件 ${fileName}`}
        title="下载"
      >
        {isDownloading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Download className="w-5 h-5" />
        )}
      </button>
    </div>
  );
});

FileMessage.displayName = 'FileMessage';

export default FileMessage;
