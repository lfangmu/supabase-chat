/**
 * 文件类型白名单 + 魔数（magic bytes）嗅探（CODE-REVIEW-2026-09-28.md P1-6 / P2-25）。
 *
 * ## 为什么需要这个模块
 *
 * **P2-25**：白名单此前在 `src/config/index.ts`、`src/hooks/useFileUpload.ts`、
 * `src/app/api/upload-media/route.ts` 各抄一份，需手工同步 —— 改一处漏两处就会
 * 「前端接受、服务端拒绝」。这里收敛为**唯一**权威来源，三处统一引用。
 *
 * **P1-6**：`/api/upload-media` 此前只比对**客户端声明的 MIME**（`file.type`，可任意伪造），
 * 且扩展名直接取自 `file.name`。攻击者可上传 `evil.html`（声明 `file.type='image/png'`），
 * 存储按**扩展名**推断 Content-Type → 以 `text/html` 提供 → 存储域存储型 XSS / 钓鱼面。
 *
 * 本模块提供三道防线：
 *  1. `sniffMimeType()` —— 按文件头字节判定**真实**类型，不信任 `file.type`；
 *  2. `isMimeCompatibleWithSniffed()` —— 声明的 MIME 必须与真实类型一致；
 *  3. `extensionForMime()` —— 落盘扩展名由白名单**反查**得出，绝不用 `file.name`。
 */

// ---------------------------------------------------------------------------
// 1. 权威白名单
// ---------------------------------------------------------------------------

/** 可**内联展示**的类型（浏览器直接渲染，不经下载）。 */
export const INLINE_SAFE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'audio/webm',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'application/pdf',
] as const;

/** 需要走「下载」语义的类型（文档 / 压缩包 / 纯文本）。 */
export const DOCUMENT_MIME_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-rar-compressed',
  'text/plain',
  'text/csv',
  'application/json',
] as const;

/**
 * 允许上传的**全部** MIME 类型。
 *
 * 注意：这是一个**闭合**白名单，其中不含任何可执行/可渲染脚本的类型
 * （`text/html`、`image/svg+xml`、`application/javascript`、`text/xml` …）。
 * 这是消除存储型 XSS 的根本保证 —— 即使嗅探被绕过，也不存在「能被执行」的落点。
 */
export const ALLOWED_MIME_TYPES: readonly string[] = [
  ...INLINE_SAFE_MIME_TYPES,
  ...DOCUMENT_MIME_TYPES,
];

/** 图片类白名单（头像等场景）。 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

/** 视频类白名单。 */
export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/ogg'] as const;

/** 语音类白名单。 */
export const ALLOWED_VOICE_MIME_TYPES = [
  'audio/webm',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
] as const;

/** MIME → 落盘扩展名（**唯一**权威映射；绝不用上传方提供的文件名）。 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'audio/webm': 'webm',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/json': 'json',
};

/** 取白名单扩展名；不在白名单时返回 `bin`（绝不回退到上传方文件名）。 */
export function extensionForMime(mime: string): string {
  return EXTENSION_BY_MIME[mime] ?? 'bin';
}

export function isAllowedMimeType(mime: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mime);
}

export function isDocumentMimeType(mime: string): boolean {
  return (DOCUMENT_MIME_TYPES as readonly string[]).includes(mime);
}

// ---------------------------------------------------------------------------
// 2. 魔数嗅探
// ---------------------------------------------------------------------------

function startsWithBytes(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, str: string, offset = 0): boolean {
  if (bytes.length < offset + str.length) return false;
  for (let i = 0; i < str.length; i += 1) {
    if (bytes[offset + i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * 判定样本是否像「纯文本」（UTF-8 可解码、且不含 NUL 字节）。
 *
 * 样本可能从多字节字符中间截断，因此失败时最多回退 3 个字节重试
 * （UTF-8 单字符最长 4 字节）。
 */
function isProbablyText(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) return false;
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const maxTrim = Math.min(3, Math.max(0, bytes.length - 1));
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      decoder.decode(bytes.subarray(0, bytes.length - trim));
      return true;
    } catch {
      /* 尾部截断，继续回退 */
    }
  }
  return false;
}

/** 嗅探结果的内部标识（一个标识可能对应多个合法 MIME，如 zip 家族）。 */
export type SniffedKind =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'
  | 'audio/wav'
  | 'ogg'
  | 'webm'
  | 'mp4'
  | 'audio/mp3'
  | 'application/pdf'
  | 'zip'
  | 'rar'
  | 'ole2'
  | 'text';

/**
 * 按文件头字节嗅探真实类型；无法识别返回 `null`。
 *
 * 只读取调用方提供的前若干 KB 样本即可（见 `SNIFF_SAMPLE_BYTES`）。
 */
export function sniffMimeType(bytes: Uint8Array): SniffedKind | null {
  if (bytes.length === 0) return null;

  // 图片
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (asciiAt(bytes, 'GIF87a') || asciiAt(bytes, 'GIF89a')) return 'image/gif';
  if (asciiAt(bytes, 'RIFF') && asciiAt(bytes, 'WEBP', 8)) return 'image/webp';

  // 音频
  if (asciiAt(bytes, 'RIFF') && asciiAt(bytes, 'WAVE', 8)) return 'audio/wav';
  if (asciiAt(bytes, 'ID3')) return 'audio/mp3';
  // MPEG-1/2 帧同步：11 个连续 1
  if (bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0) return 'audio/mp3';

  // 容器
  if (asciiAt(bytes, 'OggS')) return 'ogg';
  // EBML（WebM / Matroska）
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  // ISO BMFF：`....ftyp`（mp4 / m4a / mov …）
  if (asciiAt(bytes, 'ftyp', 4)) return 'mp4';

  // 文档 / 压缩包
  if (asciiAt(bytes, '%PDF')) return 'application/pdf';
  if (
    startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) || // 普通 zip 条目
    startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06]) || // 空归档
    startsWithBytes(bytes, [0x50, 0x4b, 0x07, 0x08]) // 分卷归档
  ) {
    return 'zip';
  }
  if (asciiAt(bytes, 'Rar!')) return 'rar';
  // OLE2 复合文档（旧版 doc / xls / ppt）
  if (startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole2';

  // 纯文本兜底（txt / csv / json）
  if (isProbablyText(bytes)) return 'text';

  return null;
}

/** 嗅探只需文件头的前 4KB —— 无需把整个文件读进内存。 */
export const SNIFF_SAMPLE_BYTES = 4096;

/** 声明的 MIME → 可接受的嗅探结果集合。 */
const COMPATIBLE_SNIFFS: Record<string, readonly SniffedKind[]> = {
  'image/jpeg': ['image/jpeg'],
  'image/jpg': ['image/jpeg'],
  'image/png': ['image/png'],
  'image/gif': ['image/gif'],
  'image/webp': ['image/webp'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'video/ogg': ['ogg'],
  'audio/webm': ['webm'],
  'audio/mp3': ['audio/mp3'],
  'audio/ogg': ['ogg'],
  'audio/wav': ['audio/wav'],
  'application/pdf': ['application/pdf'],
  // 旧版 Office：OLE2 复合文档
  'application/msword': ['ole2'],
  'application/vnd.ms-excel': ['ole2'],
  'application/vnd.ms-powerpoint': ['ole2'],
  // 新版 Office：本质是 zip
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['zip'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['zip'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['zip'],
  'application/zip': ['zip'],
  'application/x-rar-compressed': ['rar'],
  // 文本家族
  'text/plain': ['text'],
  'text/csv': ['text'],
  'application/json': ['text'],
};

/** 声明的 MIME 是否与嗅探出的真实类型一致。 */
export function isMimeCompatibleWithSniffed(mime: string, sniffed: SniffedKind | null): boolean {
  if (!sniffed) return false;
  const allowed = COMPATIBLE_SNIFFS[mime];
  return Array.isArray(allowed) && allowed.includes(sniffed);
}

// ---------------------------------------------------------------------------
// 3. 一站式校验
// ---------------------------------------------------------------------------

export type UploadValidation =
  | { ok: true; mime: string; extension: string; inlineSafe: boolean }
  | { ok: false; status: 415; message: string };

/**
 * 校验一次上传：白名单 → 魔数嗅探 → 一致性 → 落盘扩展名。
 *
 * @param declaredMime 客户端声明的 `file.type`（不可信）
 * @param sample       文件头样本（建议前 `SNIFF_SAMPLE_BYTES` 字节）
 * @param allowed      本次场景允许的 MIME 子集（默认全量白名单）
 */
export function validateUpload(
  declaredMime: string,
  sample: Uint8Array,
  allowed: readonly string[] = ALLOWED_MIME_TYPES
): UploadValidation {
  if (!allowed.includes(declaredMime)) {
    return { ok: false, status: 415, message: '不支持的文件类型' };
  }

  const sniffed = sniffMimeType(sample);
  if (!sniffed) {
    return { ok: false, status: 415, message: '无法识别的文件内容' };
  }

  if (!isMimeCompatibleWithSniffed(declaredMime, sniffed)) {
    // 关键：`evil.html` 声明成 `image/png` 会在这里被拦下（真实类型为 text）
    return { ok: false, status: 415, message: '文件内容与声明的类型不符' };
  }

  return {
    ok: true,
    mime: declaredMime,
    extension: extensionForMime(declaredMime),
    inlineSafe: (INLINE_SAFE_MIME_TYPES as readonly string[]).includes(declaredMime),
  };
}
