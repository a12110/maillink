import { PREWARM_DUE_TOLERANCE_SEC, PREWARM_MAX_ROUNDS_PER_RUN, PREWARM_ROUND_SIZE } from "../constants";
import { getLastRun, getPrewarmCursor, setPrewarmCursor } from "../db/cron-state";
import { listActiveMailboxAddresses } from "../db/mailbox-addresses";
import { getSettings } from "../db/settings";
import { getOrBuild } from "../mail-index";
import type { IndexedItem } from "../mail-index";
import { countAfter, listAfter, listCandidates } from "../mail-source";
import type { MailCandidate } from "../mail-source";
import type { CronEnv } from "./types";

// 后台预热 mail_index（01 §2 cron）：已导入且启用地址的新邮件提前解析好，用户访问时不必现场解析。
// 是否运行、隔多久运行由系统设置 prewarm.*（默认关闭）决定，见 isPrewarmDue。
// 一次运行按 PREWARM_ROUND_SIZE 一轮循环，追上最新邮件就停；轮数到 PREWARM_MAX_ROUNDS_PER_RUN 还没追上，
// 记下积压数量（remaining），下次运行从游标继续。只读 MAIL_DB，只写 APP_DB 的 mail_index 与游标。

const SECONDS_PER_MINUTE = 60;

export type PrewarmProcessed = {
  addresses: number;
  rounds: number;
  candidates: number;
  ok: number;
  failed: number;
  pending: number;
  /** 轮数用完时游标之后还剩多少封；追上了为 0 */
  remaining: number;
};

/** 预热开着、且距上次运行已满一个间隔（留 PREWARM_DUE_TOLERANCE_SEC 容差）才运行；从未运行过的直接运行 */
export async function isPrewarmDue(db: D1Database, now: number): Promise<boolean> {
  const settings = await getSettings(db, ["prewarm.enabled", "prewarm.interval_minutes"]);
  if (!settings["prewarm.enabled"]) return false;
  const last = await getLastRun(db, "prewarm");
  if (last === null) return true;
  return now - last.started_at >= settings["prewarm.interval_minutes"] * SECONDS_PER_MINUTE - PREWARM_DUE_TOLERANCE_SEC;
}

async function fetchRound(env: CronEnv, addresses: string[], cursor: number | null): Promise<MailCandidate[]> {
  // 第一次运行没有游标：只取最近一轮，不去回填历史（历史邮件仍按需解析）
  if (cursor === null) return await listCandidates(env.MAIL_DB, { addresses, limit: PREWARM_ROUND_SIZE });
  return await listAfter(env.MAIL_DB, { addresses, afterId: cursor, limit: PREWARM_ROUND_SIZE });
}

/** 游标只推进到"全部处理完"的最大 id：遇到没轮到解析的邮件就停在它前面，下次从那里继续 */
function nextCursor(candidates: readonly MailCandidate[], items: readonly IndexedItem[]): number | null {
  const firstPending = items.find((item) => item.status === "pending");
  const done = candidates.filter((candidate) => firstPending === undefined || candidate.id < firstPending.candidate.id);
  return done.reduce<number | null>((max, candidate) => (max === null || candidate.id > max ? candidate.id : max), null);
}

type RoundResult = { candidates: number; items: readonly IndexedItem[]; cursor: number };

/** 一轮：取一批、解析、推进游标；没有新邮件返回 null */
async function runRound(env: CronEnv, addresses: string[], cursor: number | null): Promise<RoundResult | null> {
  const candidates = await fetchRound(env, addresses, cursor);
  if (candidates.length === 0) return null;
  const { items } = await getOrBuild(env, candidates, { maxParse: PREWARM_ROUND_SIZE });
  const advanceTo = nextCursor(candidates, items);
  // 每轮取的封数不超过解析上限，不会有没轮到的邮件；真出现说明逻辑有误，不能让游标原地空转
  if (advanceTo === null) throw new Error("预热：本轮没有任何邮件处理完，游标无法推进");
  await setPrewarmCursor(env.APP_DB, advanceTo);
  return { candidates: candidates.length, items, cursor: advanceTo };
}

function addRound(totals: PrewarmProcessed, round: RoundResult): PrewarmProcessed {
  const count = (status: IndexedItem["status"]): number => round.items.filter((item) => item.status === status).length;
  return {
    ...totals,
    rounds: totals.rounds + 1,
    candidates: totals.candidates + round.candidates,
    ok: totals.ok + count("ok"),
    failed: totals.failed + count("failed"),
    pending: totals.pending + count("pending"),
  };
}

export async function prewarmMailIndex(env: CronEnv): Promise<PrewarmProcessed> {
  const addresses = await listActiveMailboxAddresses(env.APP_DB);
  let totals: PrewarmProcessed = { addresses: addresses.length, rounds: 0, candidates: 0, ok: 0, failed: 0, pending: 0, remaining: 0 };
  if (addresses.length === 0) return totals;

  let cursor = await getPrewarmCursor(env.APP_DB);
  for (let round = 1; round <= PREWARM_MAX_ROUNDS_PER_RUN; round += 1) {
    const result = await runRound(env, addresses, cursor);
    if (result === null) return totals;
    totals = addRound(totals, result);
    // 不满一轮：已追上最新邮件
    if (result.candidates < PREWARM_ROUND_SIZE) return totals;
    if (round === PREWARM_MAX_ROUNDS_PER_RUN) {
      return { ...totals, remaining: await countAfter(env.MAIL_DB, { addresses, afterId: result.cursor }) };
    }
    cursor = result.cursor;
  }
  return totals;
}
