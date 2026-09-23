import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { UPLOAD_CONFIG } from '@/config';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'edge';


/** Check if a MIME type is a non-media file type (document/archive/text) */
function isFileMimeType(mime: string): boolean {
  const fileTypes = [
    'application/pdf',
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
  ];
  return fileTypes.includes(mime);
}

export async function POST(request: NextRequest) {
  try {
    // 必须登录，且为房间成员（防匿名上传 / 向非所在房间上传）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const roomId = formData.get('roomId') as string | null;

    if (!file || !roomId) {
      return NextResponse.json(
        { success: false, message: '缺少文件或群聊 ID' },
        { status: 400 }
      );
    }

    // Reject malformed room IDs
    if (!/^[a-zA-Z0-9\u4e00-\u9fff_:-]+$/.test(roomId) || roomId.length > 200) {
      return NextResponse.json(
        { success: false, message: '无效的群聊 ID' },
        { status: 400 }
      );
    }

    // 校验上传者确为该房间成员
    const memberClient = getServiceClient();
    const { data: me } = await memberClient
      .from('room_members')
      .select('user')
      .eq('room_id', roomId)
      .eq('user', actor)
      .maybeSingle();
    if (!me) {
      return NextResponse.json(
        { success: false, message: '仅群成员可上传文件' },
        { status: 403 }
      );
    }

    if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, message: '文件超过大小限制' },
        { status: 413 }
      );
    }

    if (!UPLOAD_CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, message: '不支持的文件类型' },
        { status: 415 }
      );
    }

    const fileExt = file.name.split('.').pop() || 'bin';
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${roomId}/${fileName}`;

    const supabase = getServiceClient();

    // For file types, set content-disposition to attachment for download
    const isFile = isFileMimeType(file.type);
    const uploadOptions = isFile
      ? {
          upsert: false,
          contentType: file.type,
        }
      : { upsert: false };

    const { error } = await supabase.storage
      .from('chat-media')
      .upload(filePath, file, uploadOptions);

    if (error) {
      console.error('上传文件失败:', error);
      return NextResponse.json(
        { success: false, message: '上传失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, filePath });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}
