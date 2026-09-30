import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';

const SIGNED_URL_EXPIRY = 3600; // 1 hour

export async function POST(request: NextRequest) {
  try {
    // 仅登录用户可生成签名 URL（防未授权滥用对象存储）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const { path } = await request.json();

    if (!path || typeof path !== 'string') {
      return NextResponse.json(
        { success: false, message: '无效的路径' },
        { status: 400 }
      );
    }

    // Validate path format: must contain at least one "/" (e.g. "roomId/filename.ext")
    // Reject plain text, paths without slashes, or suspicious path traversal
    if (!path.includes('/') || path.startsWith('/') || path.includes('..')) {
      return NextResponse.json(
        { success: false, message: '无效的路径格式' },
        { status: 400 }
      );
    }

    // 只能为「自己所在房间」的文件生成签名 URL（防越权访问他人房间文件）
    const roomId = path.split('/')[0] ?? '';
    if (!roomId) {
      return NextResponse.json({ success: false, message: '无效的路径格式' }, { status: 400 });
    }
    const supabaseForCheck = getServiceClient();
    if (!(await isRoomParticipant(roomId, actor, supabaseForCheck))) {
      return NextResponse.json(
        { success: false, message: '无权访问该房间文件' },
        { status: 403 }
      );
    }

    const supabase = getServiceClient();

    const { data, error } = await supabase.storage
      .from('chat-media')
      .createSignedUrl(path, SIGNED_URL_EXPIRY);

    if (error || !data) {
      // Distinguish "not found" from actual server errors
      const isNotFound = error?.message?.includes('not found') ||
        error?.message?.includes('Object not found') ||
        error?.statusCode === '404';
      return NextResponse.json(
        { success: false, message: error?.message || '生成签名URL失败' },
        { status: isNotFound ? 404 : 500 }
      );
    }

    return NextResponse.json({ success: true, signedUrl: data.signedUrl });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}

export const runtime = 'edge';
