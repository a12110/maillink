import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api } from "../../api/instance";
import { PARTIAL_RETRY_DELAYS_MS } from "../../constants";
import { MailListStore } from "./list-store";
import { filtersKey, toListQuery } from "./search";
import type { MailFilters } from "./search";

/** 同一组筛选条件反复构造出的对象保持同一个引用，避免选中邮件（只改 id）时触发重新加载 */
function useStableFilters(filters: MailFilters): MailFilters {
  const key = filtersKey(filters);
  const [stable, setStable] = useState({ key, filters });
  if (stable.key !== key) setStable({ key, filters });
  return stable.filters;
}

/** 管理端邮件列表：筛选条件变化时从第一页重新加载 */
export function useMailList(filters: MailFilters) {
  const stable = useStableFilters(filters);
  const store = useMemo(
    () => new MailListStore((cursor) => api.listAdminMails(toListQuery(stable, cursor)), PARTIAL_RETRY_DELAYS_MS),
    [stable],
  );
  useEffect(() => {
    store.start();
    return () => store.dispose();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { store, state };
}
