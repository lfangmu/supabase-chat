-- ============================================================
-- 00022 — 自动为新建的 auth.users 创建 public.users 资料行
--
-- Supabase Auth 负责身份（auth.users），但应用层的展示名/头像/角色在 public.users。
-- 没有这一层，匿名/邮箱注册后 public.users 没有对应行，所有按 id 查 display_name 的逻辑都会落空。
--
-- 触发时机：auth.users 插入后（注册 / 匿名登录 / 第三方登录都会触发）。
-- display_name 取值优先级：注册时传入的 user_metadata.display_name → 邮箱前缀 → '匿名用户'。
-- 绑定邮箱（匿名升级）不会触发本触发器（auth.users 是 UPDATE），展示名由前端走资料更新接口修改。
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, display_name, avatar, signature)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NULLIF(split_part(NEW.email, '@', 1), ''),
      '匿名用户'
    ),
    NULL,
    ''
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 给已存在却缺资料行的 auth 用户兜底补一行（一次性，幂等）
INSERT INTO public.users (id, display_name, avatar, signature)
SELECT
  u.id,
  COALESCE(NULLIF(split_part(u.email, '@', 1), ''), '匿名用户'),
  NULL,
  ''
FROM auth.users u
LEFT JOIN public.users p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
