import { useState } from "react";

/** 游标分页：栈里第 i 项是第 i+1 页的 cursor（第 1 页没有）；上一页 = 出栈。换筛选时 reset */
export function useCursorStack() {
  const [cursors, setCursors] = useState<string[]>([]);
  return {
    cursor: cursors.at(-1),
    page: cursors.length + 1,
    reset: () => setCursors([]),
    forward: (next: string) => setCursors([...cursors, next]),
    back: () => setCursors(cursors.slice(0, -1)),
  };
}
