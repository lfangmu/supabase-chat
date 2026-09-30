-- 00025_harden_friends_rls.sql
--
-- 修复 CODE-REVIEW-2026-09-28.md P1-5。
--
-- 问题现象（supabase/migrations/00021_rls_uuid.sql:132-134）：
--     CREATE POLICY "Manage own friends" ON public.friends FOR ALL TO authenticated
--       USING (user_a = auth.uid() OR user_b = auth.uid())
--       WITH CHECK (user_a = auth.uid() OR user_b = auth.uid());
--   `FOR ALL` + 只校验「我是两端之一」+ **未限制 `status` 与 `requested_by`**。
--   任何登录用户可绕过 `/api/friends` 的同意流程，直接：
--     POST /api/rest/v1/friends
--     { "user_a": "<较小的UUID>", "user_b": "<较大的UUID>",
--       "status": "accepted", "requested_by": "<受害者 UUID>" }
--   伪造「对方已同意」的双向好友关系（也会出现在对方好友列表里）。
--
-- 修复后预期结果：
--   - INSERT：只能以**本人**身份发起 `status='pending'` 的申请（requested_by 必须是本人）；
--   - UPDATE：只有**被申请方**能把 pending 流转为 accepted/blocked，且不得篡改 requested_by；
--   - DELETE：本人一侧可解除关系；
--   - 状态流转/拉黑等全部由服务端 API（service_role）执行，不受上述策略限制。
--
-- 说明：应用内所有 friends 读写都走 `/api/friends`（service_role，见
--   `src/app/api/friends/route.ts:50,134,200,255`），客户端不经 `/api/rest/v1` 直连该表
--   （已 grep 确认 `from('friends')` 在 src/ 下仅出现在该 API 路由中），因此收紧不影响现有功能。

ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friends TO authenticated;

-- 1. SELECT：保持「只看得到与我相关的关系」
DROP POLICY IF EXISTS "Read own friends" ON public.friends;
CREATE POLICY "Read own friends" ON public.friends FOR SELECT TO authenticated
  USING (user_a = auth.uid() OR user_b = auth.uid());

-- 2. 移除过宽的 FOR ALL 策略
DROP POLICY IF EXISTS "Manage own friends" ON public.friends;

-- 3. INSERT：只能发起「我自己的 pending 申请」，绝不允许直接写 accepted/blocked
DROP POLICY IF EXISTS "Send own friend request" ON public.friends;
CREATE POLICY "Send own friend request" ON public.friends FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND status = 'pending'
    AND (user_a = auth.uid() OR user_b = auth.uid())
  );

-- 4. UPDATE：只有被申请方（requested_by <> 我）能对 pending 行做通过/拉黑
DROP POLICY IF EXISTS "Respond to friend request" ON public.friends;
CREATE POLICY "Respond to friend request" ON public.friends FOR UPDATE TO authenticated
  USING (
    (user_a = auth.uid() OR user_b = auth.uid())
    AND status = 'pending'
    AND requested_by <> auth.uid()
  )
  WITH CHECK (
    (user_a = auth.uid() OR user_b = auth.uid())
    AND status IN ('accepted', 'blocked')
    AND requested_by <> auth.uid()
  );

-- 5. DELETE：本人一侧可解除关系（取消申请 / 删除好友 / 取消拉黑）
DROP POLICY IF EXISTS "Remove own friend relation" ON public.friends;
CREATE POLICY "Remove own friend relation" ON public.friends FOR DELETE TO authenticated
  USING (user_a = auth.uid() OR user_b = auth.uid());

-- 6. service_role 保持全权（服务端 API 依赖）
DROP POLICY IF EXISTS "Service role full friends" ON public.friends;
CREATE POLICY "Service role full friends" ON public.friends FOR ALL TO service_role
  USING (true) WITH CHECK (true);
