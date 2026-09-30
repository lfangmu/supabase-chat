-- 00026_secure_realtime_messages_rls.sql
--
-- 修复 CODE-REVIEW-2026-09-28.md P0-1 的数据库层兜底：
--   给 Supabase Realtime 的 `realtime.messages` 表建 RLS 策略，作为应用层
--   realtimeProxy.ts 鉴权链的纵深防御。
--
-- ⚠️ 关键平台约束（Supabase 官方 troubleshooting）：
--   `realtime.messages` 由内部角色 `supabase_realtime_admin` 拥有，`postgres`
--   不是其成员、也不是超级用户。supautils 只把 **policy 类语句**
--   （create/alter/drop policy、comment on policy）以及 select/insert、
--   `grant select/insert to 自己的角色` 委托给 postgres；
--   **任何 `ALTER TABLE` 形式都不被委托**。
--
--   而 RLS 在该表上「默认已开启」（relrowsecurity=true）。Postgres 在判断
--   `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` 是否会改变设置 *之前* 就先校验
--   表归属，于是即便 RLS 已经是开着的，这条语句也会报
--   `42501 must be owner of table messages`，并**中断整个事务**——其后的
--   CREATE POLICY 全部被跳过。这正是 GitHub 集成「静默失败、schema_migrations
--   不落库」的根因。
--
--   ⇒ 本迁移**严禁**出现任何 `ALTER TABLE realtime.messages` 语句；RLS 已开，
--     要确认就查目录：`select relrowsecurity from pg_class where oid='realtime.messages'::regclass;`
--
-- 应用层鉴权（realtimeProxy.handleRealtimeSend/SSE）已做且线上复验闭环：
--   token 验签 → 事件白名单 → isRoomParticipant/isDMParticipant → AUTHOR_ONLY 消息作者校验。
-- 本迁移提供纵深防御：攻击者即便绕过代理（拿 anon key + 用户 JWT 直连 Supabase
-- Realtime WS / 直调 /realtime/v1/api/broadcast），也要过数据库层这一关——
--   ① 必须是我所在的房间，或 ② 必须是全局频道；
--   ③ 代理自身不受影响——WS phx_join 与 REST broadcast 都用真实用户 token，
--      策略对参与者必然「放过」；service_role 默认 BYPASSRLS 亦不受影响。
--
-- 注意：策略只在「Realtime Authorization 开启」时才会真正被求值（频道 private:true
-- 或项目级关闭 Allow public access）。当前代理走 private:false，故本迁移上线后
-- 策略处于「就绪但休眠」状态；要真正生效需另行开启 Authorization（见末尾备注）。

-- ===========================================================================
-- 1. 工具函数：从 topic 抽取 roomId（放在 public 模式，postgres 可自由建/改）
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.realtime_topic_room(p_topic text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_topic ~ '^realtime:chat-room:(.+)$'
      THEN (regexp_match(p_topic, '^realtime:chat-room:(.+)$'))[1]
    WHEN p_topic ~ '^chat-room:(.+)$'
      THEN (regexp_match(p_topic, '^chat-room:(.+)$'))[1]
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.realtime_topic_room(text) IS
  '把 Realtime topic 归一成房间 id（兼容带/不带 realtime: 前缀的两种形态）。非房间 topic 返回 NULL。';

-- 显式 GRANT：函数建在 public，postgres 可授权 EXECUTE 给 anon/authenticated。
GRANT EXECUTE ON FUNCTION public.realtime_topic_room(text) TO authenticated, anon;

-- ===========================================================================
-- 2. 表级授权（仅 select/insert，不碰 ALTER TABLE）
-- ===========================================================================
-- RLS 已开启，这里只补「表特权」：没有 GRANT，即便策略放行，角色也无权读写。
-- GRANT ALL 不在 supautils 委托清单内（含 update/delete/truncate 等），故用显式 select,insert。
GRANT SELECT, INSERT ON realtime.messages TO authenticated;
GRANT SELECT, INSERT ON realtime.messages TO service_role;

-- ===========================================================================
-- 3. authenticated 的 SELECT 策略：房间成员 OR 全局频道
--    用 (select realtime.topic()) 取「本次连接正在加入的 topic」——
--    realtime.messages 本身无数据行，引用 topic 列会恒为 NULL 而误杀所有人。
-- ===========================================================================
DROP POLICY IF EXISTS "realtime messages: read by participant or global" ON realtime.messages;
CREATE POLICY "realtime messages: read by participant or global"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    -- 全局频道：chat-events（room-updated / new-dm）、presence:global（在线列表）
    -- 兼容 WS 订阅（带 realtime: 前缀）与 REST broadcast（不带前缀）两种形态。
    (select realtime.topic()) IN (
      'chat-events',
      'realtime:chat-events',
      'presence:global',
      'realtime:presence:global'
    )
    OR
    -- 房间频道：必须是房间成员或创建者
    (
      public.realtime_topic_room((select realtime.topic())) IS NOT NULL
      AND public.is_room_participant(
        public.realtime_topic_room((select realtime.topic())),
        auth.uid()
      )
    )
  );

-- ===========================================================================
-- 4. authenticated 的 INSERT 策略：与 SELECT 同步——只能向自己所在的房间
--    或全局频道广播（broadcast send 走 INSERT 策略求值）
-- ===========================================================================
DROP POLICY IF EXISTS "realtime messages: insert by participant or global" ON realtime.messages;
CREATE POLICY "realtime messages: insert by participant or global"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select realtime.topic()) IN (
      'chat-events',
      'realtime:chat-events',
      'presence:global',
      'realtime:presence:global'
    )
    OR
    (
      public.realtime_topic_room((select realtime.topic())) IS NOT NULL
      AND public.is_room_participant(
        public.realtime_topic_room((select realtime.topic())),
        auth.uid()
      )
    )
  );

-- ===========================================================================
-- 5. service_role 全权策略（服务端 / realtime server 内部走此角色，默认 BYPASSRLS）
-- ===========================================================================
DROP POLICY IF EXISTS "realtime messages: service_role full" ON realtime.messages;
CREATE POLICY "realtime messages: service_role full"
  ON realtime.messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ===========================================================================
-- 备注
-- ===========================================================================
-- - realtime.messages 的 `relforcerowsecurity=false` 保持不变：realtime admin
--   通常是表 owner，绕过 RLS，无需为本迁移额外开 FORCE RLS。
-- - UPDATE / DELETE 对 authenticated 默认拒绝（无策略），符合本应用「应用层
--   从不直接改写 realtime.messages」的实际行为；如未来需要再单独补策略。
-- - 任何「以本人 token 直连 Supabase Realtime WS / 直调 /realtime/v1/api/broadcast」
--   的非成员写操作会被本策略在数据库层卡掉（之前完全无兜底）；
--   应用自身的代理路径不受影响——代理用真实用户 token + 服务端已校验成员，
--   策略对参与者必然放过。
-- - 要使策略真正生效（根治），需开启 Realtime Authorization：
--     (a) 项目级：Supabase Dashboard → Realtime → Settings 关闭 "Allow public access"；或
--     (b) 频道级：代理在 phx_join / broadcast 的 config 里置 private:true。
--   开启前务必先用本策略验证「参与者能 JOIN、非参与者被拒」，避免全站实时中断。
