import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // 获取当前密码
    const currentPassword = process.env.CHAT_PASSWORD;
    
    if (!currentPassword) {
      return NextResponse.json(
        { success: false, message: '服务器配置错误' },
        { status: 500 }
      );
    }

    // 生成密码的哈希值作为版本标识
    // 这样既不暴露密码内容，又能检测到密码变化
    const encoder = new TextEncoder();
    const data = encoder.encode(currentPassword);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return NextResponse.json({ 
      success: true, 
      version: passwordHash,
      timestamp: Date.now()
    });
    
  } catch (error) {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}

export const runtime = 'edge';