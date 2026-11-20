import { ORPHAN_SCAN_BATCH_SIZE, ORPHAN_SCAN_MAX_BATCHES } from "../constants";
import { getOrphanScanCursor, setOrphanScanCursor } from "../db/cron-state";
import { deleteIndexRows, listIndexedIdsAfter } from "../db/mail-index-maintenance";
import { listExistingMailIds } from "../mail-source/exists";
import type { CronEnv, Processed } from "./types";

// 删除 mail_index 里 MAIL_DB 已不存在的行。每次最多扫 ORPHAN_SCAN_BATCH_SIZE × ORPHAN_SCAN_MAX_BATCHES 行，
// 游标记在 settings，扫到末尾后回到 0，下一轮重新开始。
// MAIL_DB 查询失败（含不健康）会直接抛出，游标不推进、也不会误删。

export async function cleanOrphanIndexRows(env: CronEnv): Promise<Processed> {
  let after = (await getOrphanScanCursor(env.APP_DB)) ?? 0;
  let scanned = 0;
  let deleted = 0;

  for (let batch = 0; batch < ORPHAN_SCAN_MAX_BATCHES; batch += 1) {
    const ids = await listIndexedIdsAfter(env.APP_DB, after, ORPHAN_SCAN_BATCH_SIZE);
    if (ids.length === 0) {
      after = 0;
      break;
    }
    const existing = await listExistingMailIds(env.MAIL_DB, ids);
    deleted += await deleteIndexRows(env.APP_DB, ids.filter((id) => !existing.has(id)));
    scanned += ids.length;
    after = ids[ids.length - 1] ?? after;
  }

  await setOrphanScanCursor(env.APP_DB, after);
  return { mail_index_scanned: scanned, mail_index_orphans_deleted: deleted };
}
