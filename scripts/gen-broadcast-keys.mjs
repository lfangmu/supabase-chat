// 生成「消息广播防伪造」用的 Ed25519 密钥对。
//
// 输出两份标准 base64（非 url-safe）：
//   1) PRIVATE (PKCS8) -> 设为 Supabase 函数 secret：BROADCAST_SIGNING_KEY
//   2) PUBLIC  (SPKI)  -> 设为 Cloudflare Pages 环境变量：NEXT_PUBLIC_BROADCAST_VERIFY_KEY
//
// 私钥只存 Supabase 函数环境变量，永不下发到前端；公钥随前端构建内联，可公开。
// 运行：node scripts/gen-broadcast-keys.mjs
// 不想装 node？双击 scripts/gen-broadcast-keys.html 在浏览器里一键生成（零安装）。
import { webcrypto } from 'node:crypto';

const kp = await webcrypto.subtle.generateKey(
  { name: 'Ed25519' },
  true,
  ['sign', 'verify']
);

const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey));
const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', kp.publicKey));

const toB64 = (b) => Buffer.from(b).toString('base64');

console.log('----- 复制下面两行，分别设置到对应平台 -----\n');
console.log('BROADCAST_SIGNING_KEY=' + toB64(pkcs8));
console.log('NEXT_PUBLIC_BROADCAST_VERIFY_KEY=' + toB64(spki));
console.log('\n------------------------------------------------');
console.log('Supabase：Functions 环境变量（或 Secrets）添加 BROADCAST_SIGNING_KEY');
console.log('Cloudflare Pages：Build 环境变量添加 NEXT_PUBLIC_BROADCAST_VERIFY_KEY（需重新构建生效）');
console.log('\n部署顺序：先设 Supabase 私钥并重新部署 Edge Function（自动），确认生效后再设 Cloudflare 公钥并重新构建。');
