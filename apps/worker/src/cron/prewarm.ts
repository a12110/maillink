import { PREWARM_BATCH_SIZE } from "../constants";
import { getPrewarmCursor, setPrewarmCursor } from "../db/cron-state";
import { listActiveMailboxAddresses } from "../db/mailbox-addresses";
import { getOrBuild } from "../mail-index";
import type { IndexedItem } from "../mail-index";
import { listAfter, listCandidates } from "../mail-source";
import type { MailCandidate } from "../mail-source";
import type { CronEnv, Processed } from "./types";

// 预热 mail_index（01 §2 cron）：已导入且启用地址的新邮件提前解析好，用户访问时不必现场解析。
// 只读 MAIL_DB，只写 APP_DB 的 mail_index 与游标。

async function fetchCandidates(env: CronEnv, addresses: string[], cursor: number | null): Promise<MailCandidate[]> {
  // 第一次运行没有游标：只取最近一批，不去回填历史（历史邮件仍按需解析）
  if (cursor === null) return await listCandidates(env.MAIL_DB, { addresses, limit: PREWARM_BATCH_SIZE });
  return await listAfter(env.MAIL_DB, { addresses, afterId: cursor, limit: PREWARM_BATCH_SIZE });
}

/** 游标只推进到"全部处理完"的最大 id：遇到没轮到解析的邮件就停在它前面，下次从那里继续 */
function nextCursor(candidates: readonly MailCandidate[], items: readonly IndexedItem[]): number | null {
  const firstPending = items.find((item) => item.status === "pending");
  const done = candidates.filter((candidate) => firstPending === undefined || candidate.id < firstPending.candidate.id);
  return done.reduce<number | null>((max, candidate) => (max === null || candidate.id > max ? candidate.id : max), null);
}

export async function prewarmMailIndex(env: CronEnv): Promise<Processed> {
  const addresses = await listActiveMailboxAddresses(env.APP_DB);
  const empty = { addresses: addresses.length, candidates: 0, ok: 0, failed: 0, pending: 0 };
  if (addresses.length === 0) return empty;

  const cursor = await getPrewarmCursor(env.APP_DB);
  const candidates = await fetchCandidates(env, addresses, cursor);
  if (candidates.length === 0) return empty;

  const { items } = await getOrBuild(env, candidates, { maxParse: PREWARM_BATCH_SIZE });
  const advanceTo = nextCursor(candidates, items);
  if (advanceTo !== null) await setPrewarmCursor(env.APP_DB, advanceTo);

  const count = (status: IndexedItem["status"]): number => items.filter((item) => item.status === status).length;
  return { ...empty, candidates: candidates.length, ok: count("ok"), failed: count("failed"), pending: count("pending") };
}
