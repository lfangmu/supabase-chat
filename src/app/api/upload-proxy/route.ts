import { NextRequest, NextResponse } from 'next/server';
import { extractSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const jwtSecret = process.env.CHAT_JWT_SECRET;
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, message: '服务器配置错误' },
        { status: 500 }
      );
    }

    // Require authentication
    const cookieHeader = request.headers.get('cookie');
    const session = await extractSession(cookieHeader, jwtSecret);
    if (!session.valid) {
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

    const imgbbForm = new FormData();
    imgbbForm.append('image', file);
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
