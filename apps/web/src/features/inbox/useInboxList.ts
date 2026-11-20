import type { MyMailListItem } from "@maillink/shared";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "../../api/instance";
import { PARTIAL_RETRY_DELAYS_MS } from "../../constants";
import { MailListStore } from "../mails/list-store";

/**
 * 我的邮件列表：复用 UI-2 的 `MailListStore`（游标分页 + `partial` 时 1s/2s/4s 退避重取同一页、不推进游标）。
 * 换邮箱（mailbox_id 变化）从第一页重新加载；`enabled=false`（邮箱不可用）时不发请求。
 */
export function useInboxList(mailboxId: number | undefined, enabled: boolean) {
  const store = useMemo(
    () => new MailListStore<MyMailListItem>((cursor) => api.myMails({ mailbox_id: mailboxId, cursor }), PARTIAL_RETRY_DELAYS_MS),
    [mailboxId],
  );
  useEffect(() => {
    if (!enabled) return;
    store.start();
    return () => store.dispose();
  }, [store, enabled]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { store, state };
}
