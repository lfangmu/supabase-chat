// 当前登录用户身份（Supabase Auth 会话 + 资料）。
//
// 迁移后，线上唯一身份是 Supabase Auth 的 UUID（`userId`）；
// `displayName` 来自 `public.users.display_name`，仅用于展示与 @提及文本匹配，
// 不再作为身份键。所有「这是不是我发的消息」「这个私聊是不是我的」等身份判定，
// 一律用 `userId` 比较，展示名仍走 `displayName` / `Message.user`。
export interface CurrentUser {
  /** Supabase Auth 的 UUID（auth.uid()），线上唯一身份键 */
  userId: string;
  /** 展示名（public.users.display_name），仅用于渲染与 @提及 */
  displayName: string;
  /** 邮箱（匿名登录时可能为空） */
  email?: string | null;
  /** 是否匿名登录 */
  isAnonymous?: boolean;
  /** 角色（来自 public.users.role；admin 时为管理员） */
  role?: string;
}

export function isCurrentUser(
  currentUser: CurrentUser | null,
  userId: string | undefined
): boolean {
  if (!currentUser || !userId) return false;
  return currentUser.userId === userId;
}
