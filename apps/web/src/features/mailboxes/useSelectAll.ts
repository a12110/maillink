import { useState } from "react";
import type { AdminMailbox } from "@maillink/shared";
import { api } from "../../api/instance";
import { MAILBOX_WALK_PAGE_SIZE } from "../../constants";
import { describeError } from "../../lib/messages";
import { SELECT_ALL_LIMIT } from "./batch-state";
import type { Selection } from "./useMailboxSelection";

type Filters = { q?: string; tag?: string; status?: "active" | "disabled"; has_link?: boolean };

/** “选择全部 N 项”：后端没有只返回 id 的接口，按当前筛选逐页取完（总数不超过批量上限才允许） */
export function useSelectAll(selection: Selection, filters: Filters) {
  const [walking, setWalking] = useState(false);
  const [error, setError] = useState<{ message: string; detail: string } | null>(null);
  const run = async () => {
    setWalking(true);
    setError(null);
    try {
      const all: AdminMailbox[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.listMailboxes({ ...filters, cursor, limit: MAILBOX_WALK_PAGE_SIZE });
        all.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor !== undefined && all.length <= SELECT_ALL_LIMIT);
      if (all.length > SELECT_ALL_LIMIT) throw new Error(`筛选结果超过 ${SELECT_ALL_LIMIT} 个，请缩小范围后再全选（批量操作一次最多 ${SELECT_ALL_LIMIT} 个）`);
      selection.replace(all);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setWalking(false);
    }
  };
  return { walking, error, run: () => void run(), dismissError: () => setError(null) };
}
