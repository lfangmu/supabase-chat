import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-user';
import { getServiceClient } from '@/lib/service-client';
import { isRoomParticipant } from '@/lib/rooms';
import { isValidRoomId } from '@/lib/validate';
import { validateUpload, SNIFF_SAMPLE_BYTES, ALLOWED_IMAGE_MIME_TYPES } from '@/lib/file-types';

/**
 * POST /api/upload-proxy — 服务端代传图片到 ImgBB（聊天图片的默认通道，见 `useFileUpload`）。
 *
 * P1-7 修复：此前只校验「已登录 + `file.type` 以 `image/` 开头」，**无任何用途/房间约束**，
 * 于是任何登录用户都能把它当免费无限图床，无限消耗服务端配置的 `IMGBB_API_KEY` 配额。
 *
 * 现在（三重收紧，均不影响正常聊天发图）：
 *  1. **房间作用域**：`purpose=avatar`（头像，见 MePage）之外，必须传 `roomId` 且上传者是该房间成员 ——
 *     与 `/api/upload-media` 同一套 `isRoomParticipant` 语义；
 *  2. **魔数嗅探**：`file.type` 以 `image/` 开头是客户端声明，不足以证明它真是图片；
 *  3. **收紧限流**：`src/lib/rate-limit.ts` 中该路径降为 6 次/分钟。
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication（身份以 Supabase Auth 的 UUID 为准）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json(
        { success: false, message: '未认证' },
        { status: 401 }
      );
    }

    const imgbbApiKey = process.env.IMGBB_API_KEY;
    if (!imgbbApiKey) {
      return NextResponse.json(
        { success: false, message: 'ImgBB 未配置' },
        { status: 500 }
      );
    }

    // Forward the file to ImgBB with server-side validation
    const formData = await request.formData();
    const file = formData.get('image');
    const purpose = formData.get('purpose');
    const roomId = formData.get('roomId');

    // P1-7(1)：头像走独立用途；其余必须是「本人所在的真实房间」
    if (purpose !== 'avatar') {
      const rid = typeof roomId === 'string' ? roomId.trim() : '';
      if (!rid) {
        return NextResponse.json(
          { success: false, message: '缺少 roomId（或传 purpose=avatar）' },
          { status: 400 }
        );
      }
      if (!isValidRoomId(rid)) {
        return NextResponse.json({ success: false, message: '无效的群聊 ID' }, { status: 400 });
      }
      const memberClient = getServiceClient();
      if (!(await isRoomParticipant(rid, actor, memberClient))) {
        return NextResponse.json(
          { success: false, message: '仅群成员可上传图片' },
          { status: 403 }
        );
      }
    }

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { success: false, message: '未找到文件' },
        { status: 400 }
      );
    }

    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, message: '文件超过 50MB 限制' },
        { status: 413 }
      );
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { success: false, message: '仅支持图片文件' },
        { status: 415 }
      );
    }

    // P1-7：魔数嗅探 —— `file.type` 是客户端声明的，不能作为「它真是图片」的证据
    const sample = new Uint8Array(await file.slice(0, SNIFF_SAMPLE_BYTES).arrayBuffer());
    const validation = validateUpload(file.type, sample, ALLOWED_IMAGE_MIME_TYPES);
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, message: validation.message },
        { status: validation.status }
      );
    }

    const imgbbForm = new FormData();
    // 用嗅探通过的声明类型重建 Blob，避免把伪造的 content-type 传给上游
    imgbbForm.append('image', file.slice(0, file.size, validation.mime));
    imgbbForm.append('key', imgbbApiKey);

    const response = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: imgbbForm,
      // 安全纵深：不跟随重定向，避免被恶意/被劫持的响应跳转到内网或任意地址（SSRF）。
      // 正常上传接口不应返回 3xx；若出现则按失败处理（fail-closed）。
      redirect: 'manual',
    });

    // redirect:'manual' 下，3xx 不会被自动跟随，直接视为失败
    if (response.status < 200 || response.status >= 300) {
      return NextResponse.json(
        { success: false, message: 'ImgBB 上传失败（上游异常响应）' },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (!data.success) {
      return NextResponse.json(
        { success: false, message: `ImgBB 上传失败: ${data.error?.message || '未知错误'}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url: data.data.url,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}

export const runtime = 'edge';
