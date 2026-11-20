import { useCallback, useState } from "react";
import type { AdminMailbox } from "@maillink/shared";

export type Selection = {
  selected: ReadonlyMap<number, AdminMailbox>;
  toggle: (mailbox: AdminMailbox, checked: boolean) => void;
  setMany: (mailboxes: readonly AdminMailbox[], checked: boolean) => void;
  replace: (mailboxes: readonly AdminMailbox[]) => void;
  clear: () => void;
};

/** 选中的地址连同它们的数据一起记（跨页保留，删除确认要用链接数与授权数） */
export function useMailboxSelection(): Selection {
  const [selected, setSelected] = useState<ReadonlyMap<number, AdminMailbox>>(new Map());
  const setMany = useCallback((mailboxes: readonly AdminMailbox[], checked: boolean) => {
    setSelected((current) => {
      const next = new Map(current);
      for (const mailbox of mailboxes) {
        if (checked) next.set(mailbox.id, mailbox);
        else next.delete(mailbox.id);
      }
      return next;
    });
  }, []);
  const toggle = useCallback((mailbox: AdminMailbox, checked: boolean) => setMany([mailbox], checked), [setMany]);
  const replace = useCallback((mailboxes: readonly AdminMailbox[]) => setSelected(new Map(mailboxes.map((m) => [m.id, m]))), []);
  const clear = useCallback(() => setSelected(new Map()), []);
  return { selected, toggle, setMany, replace, clear };
}
