import { useSyncExternalStore } from "react";
import type { ThemeIssueStore } from "../theme";
import { Callout } from "../ui";

/** 主题问题的可见提示：固定在视口顶部，不依赖任何路由或外壳，白屏也能看到 */
export function ThemeIssueBanner({ store }: { store: ThemeIssueStore }) {
  const issues = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (issues.length === 0) return null;
  return (
    <div className="theme-issues">
      {issues.map((issue, index) => (
        <Callout key={index} tone="danger" title={issue.title}>
          {issue.message}
        </Callout>
      ))}
    </div>
  );
}
