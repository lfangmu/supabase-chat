-- 加速 isRoomParticipant 的 eq('user', actor) 成员判定查询。
-- friends / rooms / messages / signed-url 等路由都会高频调用该判定。
-- 注意：user 是 SQL 保留字，作为列名时须加双引号，否则会被解析成 user() 函数而报
-- "functions in index expression must be marked IMMUTABLE"。
CREATE INDEX IF NOT EXISTS idx_room_members_user ON public.room_members ("user");
