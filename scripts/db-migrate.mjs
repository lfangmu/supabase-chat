#!/usr/bin/env node
/**
 * Supabase 迁移执行器（兜底通道）
 *
 * 主通道是 Supabase 的 GitHub 集成：仓库装了 supabase GitHub App，
 * push 到 main 后它会自动应用 supabase/migrations 下的新迁移，并把
 * 记录写进 supabase_migrations.schema_migrations。正常情况下本脚本
 * 只会打印「没有待执行的迁移」。
 *
 * 保留它的意义：集成一旦静默失效（例如迁移文件带 BOM 导致解析失败，
 * 8-08 就踩过一次），CI 会在这里把缺失的迁移补上并让流水线变红，
 * 而不是等到功能报 404 才发现。两条通道写同一张记录表、迁移本身幂等，
 * 并发执行不会冲突。
 *
 * 为什么不用 `supabase db push`：
 *   CLI 的 `link` 会调 Management API 拉 api keys，返回体里的 inserted_at
 *   时间格式过不了 CLI 自带的 schema 校验，报 "failed to get api keys:
 *   SchemaError"；而不 link 就得提供数据库密码（DB URL），CI 里没有。
 *   Management API 的 /database/query 端点用同一个 access token 就能直接
 *   执行任意 SQL（含 DDL），路径最短且无额外密钥。
 *
 * 执行记录沿用 Supabase 官方的 supabase_migrations.schema_migrations 表，
 * 保持与 CLI 的兼容 —— 将来若切回 `db push` 不会重复执行。
 *
 * 环境变量：
 *   SUPABASE_ACCESS_TOKEN  个人访问令牌（Account -> Access Tokens）
 *   SUPABASE_PROJECT_REF   项目 ref
 *   DRY_RUN=1              只打印计划，不实际执行
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

/**
 * 基线版本：编号 <= 该值的迁移视为「线上已执行」。
 *
 * 这些迁移是在引入本脚本之前手动执行的，线上库已有对应对象，
 * 但没有留下执行记录。首次运行时若发现记录表为空且 public.messages
 * 已存在，就把它们直接登记为已执行，避免重跑非幂等的历史脚本。
 */
const BASELINE_VERSION = '00012';

const API = 'https://api.supabase.com';
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const dryRun = process.env.DRY_RUN === '1';

if (!token || !ref) {
  console.error('缺少 SUPABASE_ACCESS_TOKEN 或 SUPABASE_PROJECT_REF，跳过迁移。');
  process.exit(1);
}

/** 执行一段 SQL，返回结果数组 */
async function runSql(sql) {
  const res = await fetch(`${API}/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.message || j.error || text;
    } catch {
      /* 保留原始文本 */
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

/** SQL 字符串字面量转义 */
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** 确保记录表存在 */
async function ensureLedger() {
  await runSql(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version TEXT PRIMARY KEY
    );
    ALTER TABLE supabase_migrations.schema_migrations
      ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE supabase_migrations.schema_migrations
      ADD COLUMN IF NOT EXISTS statements TEXT[];
  `);
}

async function getApplied() {
  const rows = await runSql(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;'
  );
  return new Set((rows || []).map((r) => r.version));
}

async function markApplied(version, name) {
  await runSql(`
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES (${lit(version)}, ${lit(name)})
    ON CONFLICT (version) DO NOTHING;
  `);
}

/** 线上是否为「已有数据的既存库」 */
async function isExistingDatabase() {
  const rows = await runSql("SELECT to_regclass('public.messages') IS NOT NULL AS exists;");
  return Boolean(rows?.[0]?.exists);
}

function loadMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const version = file.split('_')[0];
      const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '');
      // 去掉可能存在的 BOM，否则首行语句会解析失败
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(/^\uFEFF/, '');
      return { file, version, name, sql };
    });
}

async function main() {
  const migrations = loadMigrations();
  console.log(`发现 ${migrations.length} 份迁移文件`);

  await ensureLedger();
  let applied = await getApplied();

  // 首次运行：为历史迁移建立基线
  if (applied.size === 0 && (await isExistingDatabase())) {
    const baseline = migrations.filter((m) => m.version <= BASELINE_VERSION);
    console.log(
      `记录表为空但库中已有数据，将 ${baseline.length} 份历史迁移（<= ${BASELINE_VERSION}）登记为已执行`
    );
    for (const m of baseline) {
      if (!dryRun) await markApplied(m.version, m.name);
    }
    if (!dryRun) applied = await getApplied();
    else baseline.forEach((m) => applied.add(m.version));
  }

  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) {
    console.log('没有待执行的迁移，数据库已是最新。');
    return;
  }

  console.log(`待执行 ${pending.length} 份：${pending.map((m) => m.file).join(', ')}`);
  if (dryRun) {
    console.log('DRY_RUN=1，仅打印计划。');
    return;
  }

  for (const m of pending) {
    process.stdout.write(`  执行 ${m.file} ... `);
    try {
      await runSql(m.sql);
      await markApplied(m.version, m.name);
      console.log('OK');
    } catch (err) {
      // 幂等兜底：库里对象已存在（多见于「DB 已有对象但 ledger 缺记录」场景，
      // 例如历史迁移是手动/由 GitHub App 应用在 ledger 之外）时，视为已应用并跳过，
      // 而非整条流水线退出——否则一条「already exists」会连累后续迁移（含本次）全部无法继续。
      const alreadyExists =
        /already exists/i.test(err.message) ||
        /duplicate/i.test(err.message) ||
        err.message.includes('42P07') ||
        err.message.includes('42701');
      if (alreadyExists) {
        console.log('已存在，跳过');
        await markApplied(m.version, m.name);
        continue;
      }
      console.log('失败');
      console.error(`\n${m.file} 执行失败：\n${err.message}\n`);
      process.exit(1);
    }
  }

  console.log(`\n迁移完成，共执行 ${pending.length} 份。`);
}

main().catch((err) => {
  console.error('迁移器异常：', err.message);
  process.exit(1);
});
