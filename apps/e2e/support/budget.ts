import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { RATE_LIMIT_PURPOSES, RATE_LIMITED_ROUTES } from "../../worker/src/constants";

// 认证请求预算。worker 的 RATE_LIMITER 按用途分 key（路由表直接导入 apps/worker/src/constants.ts 的 RATE_LIMITED_ROUTES），
// 每个 key 每 IP 每 60 秒 N 次（N 取自 apps/worker/wrangler.jsonc），miniflare 按墙钟对齐固定窗口。
// 整套 e2e 只有几十秒，可能全落在同一个窗口，所以每个 key 在一次完整运行里的总次数必须留出余量。
// 浏览器里发出的受限请求由 guard.ts 记录；API 请求上下文（adminApi 等）只发 /api/admin/*，
// 以及 08 里故意缺 CSRF 头的登录请求——后者在 CSRF 中间件被 403 拦下，先于限流，不计次。

export const BUDGET_MARGIN = 2;
const LOG_FILE = resolve(import.meta.dirname, "..", ".auth", "rate-budget.jsonl");
const WRANGLER_CONFIG = resolve(import.meta.dirname, "..", "..", "worker", "wrangler.jsonc");

type Route = (typeof RATE_LIMITED_ROUTES)[number];

/** Hono 路径 → 匹配：`/prefix/*` 同时匹配 `/prefix` 本身与其下所有子路径，其余必须完全相等 */
function pathMatches(pattern: string, pathname: string): boolean {
  if (!pattern.endsWith("/*")) return pattern === pathname;
  const prefix = pattern.slice(0, -2);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** 一次请求消耗哪些限流 key（不受限返回空）；路由表直接取自 worker，新增路由自动跟上 */
export function budgetKeys(method: string, pathname: string, body: unknown): string[] {
  const hit = RATE_LIMITED_ROUTES.filter((route: Route) => route.method === method && pathMatches(route.path, pathname));
  const keys: string[] = [];
  for (const route of hit) {
    keys.push(route.purpose);
    if (route.usernameKeyed) {
      const name = typeof body === "object" && body !== null && "username" in body && typeof body.username === "string" ? body.username.trim().toLowerCase() : null;
      if (name !== null) keys.push(`${RATE_LIMIT_PURPOSES.loginUser}:${name}`);
    }
  }
  return keys;
}

export function resetBudgetLog(): void {
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  writeFileSync(LOG_FILE, "");
}

export function recordBudget(keys: readonly string[]): void {
  if (keys.length > 0) appendFileSync(LOG_FILE, `${JSON.stringify(keys)}\n`);
}

export function readBudgetCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of readFileSync(LOG_FILE, "utf8").split("\n")) {
    if (line === "") continue;
    for (const key of JSON.parse(line) as string[]) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** RATE_LIMITER 的每窗口上限：直接读 wrangler.jsonc（运行时真正生效的配置），不写死 */
export function rateLimitMax(): number {
  const text = readFileSync(WRANGLER_CONFIG, "utf8");
  const match = /"name":\s*"RATE_LIMITER"[\s\S]*?"limit":\s*(\d+)/.exec(text);
  if (match?.[1] === undefined) throw new Error(`在 ${WRANGLER_CONFIG} 里找不到 RATE_LIMITER 的 limit`);
  return Number(match[1]);
}

/** 超出预算的项；空数组表示都在预算内 */
export function overBudget(counts: ReadonlyMap<string, number>, max: number): string[] {
  const allowed = max - BUDGET_MARGIN;
  return [...counts]
    .filter(([, count]) => count > allowed)
    .map(([key, count]) => `${key}：实际 ${count} 次，预算 ${allowed} 次（上限 ${max} - 余量 ${BUDGET_MARGIN}）`);
}

export function budgetTable(counts: ReadonlyMap<string, number>, max: number): string {
  const rows = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `  ${key.padEnd(34)} ${count} / ${max - BUDGET_MARGIN}`);
  return ["[e2e] 认证请求预算（实际 / 预算，窗口上限 " + max + "）", ...rows].join("\n");
}
