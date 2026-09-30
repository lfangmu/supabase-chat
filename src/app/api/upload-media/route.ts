import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { UPLOAD_CONFIG } from '@/config';
import { getAuthUser } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';
import { isValidRoomId } from '@/lib/validate';
import {
  validateUpload,
  SNIFF_SAMPLE_BYTES,
  isDocumentMimeType,
  isAllowedMimeType,
} from '@/lib/file-types';

export const runtime = 'edge';


export async function POST(request: NextRequest) {
  try {
    // 必须登录，且为房间成员（防匿名上传 / 向非所在房间上传）
    const actor = await getAuthUser(request);
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

    // Reject malformed room IDs（统一走共享校验器，见 P3「房间 ID 正则不一致」）
    if (!isValidRoomId(roomId)) {
      return NextResponse.json(
        { success: false, message: '无效的群聊 ID' },
        { status: 400 }
      );
    }

    // 校验上传者确为该房间成员。
    // 必须复用 isRoomParticipant：它对公共大厅 default-room 恒为 true、对 dm:<a>:<b> 按参与者判定；
    // 若像以前那样直接查 room_members，会把「默认聊天室」里的所有人挡在门外
    // （default-room 没有任何成员行）→ 在默认聊天室发视频/语音/文件一律 403。
    // 另：头像上传用的是伪房间 'avatars'（见 MePage），它不是真实房间，单独放行（仍需登录）。
    const memberClient = getServiceClient();
    const allowed = roomId === 'avatars' || (await isRoomParticipant(roomId, actor, memberClient));
    if (!allowed) {
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

    if (!isAllowedMimeType(file.type)) {
      return NextResponse.json(
        { success: false, message: '不支持的文件类型' },
        { status: 415 }
      );
    }

    // P1-6：不信任客户端声明的 `file.type` —— 只取文件头 4KB 做魔数嗅探，
    // 并强制「声明类型 == 真实类型」。`evil.html` 声明成 `image/png` 会在此被拒。
    const sample = new Uint8Array(await file.slice(0, SNIFF_SAMPLE_BYTES).arrayBuffer());
    const validation = validateUpload(file.type, sample);
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, message: validation.message },
        { status: validation.status }
      );
    }

    // P1-6：扩展名由白名单**反查**得出，绝不使用 `file.name`（防止 evil.html → .html）。
    const fileName = `${Date.now()}.${validation.extension}`;
    const filePath = `${roomId}/${fileName}`;

    const supabase = getServiceClient();

    // P1-6：显式指定落盘 Content-Type，且**总是**指定（此前仅文档类型才带 contentType，
    // 其余交给存储按扩展名推断 —— 那正是 `evil.html` → `text/html` 的成因）。
    // 另外把上传体的 Blob type 也覆盖为白名单内的类型（`slice` 是零拷贝视图），
    // 因为 supabase-js 对 Blob 走 FormData 分支，multipart 分片的 Content-Type 取自 Blob.type，
    // 而 `options.contentType` 在该分支下不生效 —— 两处同时钉死才真正闭环。
    // 说明：JS SDK 无法设置 `Content-Disposition: attachment`；等价效果由
    // 「闭合白名单（无 text/html / svg）+ 强制扩展名 + 强制 Content-Type」共同保证。
    const uploadBody = file.slice(0, file.size, validation.mime);
    const uploadOptions = {
      upsert: false,
      contentType: validation.mime,
    };

    const { error } = await supabase.storage
      .from('chat-media')
      .upload(filePath, uploadBody, uploadOptions);

    if (error) {
      console.error('上传文件失败:', error);
      return NextResponse.json(
        { success: false, message: '上传失败' },
        { status: 500 }
      );
    }

    // 供调用方区分「内联展示」与「下载」语义（原先靠 isFileMimeType 判定）
    return NextResponse.json({
      success: true,
      filePath,
      mimeType: validation.mime,
      isFile: isDocumentMimeType(validation.mime),
    });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}
