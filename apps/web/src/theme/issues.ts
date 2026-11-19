import { AccentUnreachableError } from "./accent";
import { ThemeParamError } from "./settings";

/** 主题启动或切换时出现的、需要让用户看见的问题 */
export type ThemeIssue = { title: string; message: string };

export function toThemeIssue(error: unknown): ThemeIssue {
  if (error instanceof ThemeParamError) {
    return {
      title: `主题参数 ${error.param} 不合法`,
      message: `收到 "${error.received}"，可选 ${error.expected}。页面已按默认主题显示。`,
    };
  }
  if (error instanceof AccentUnreachableError) return { title: "强调色无法达到对比度要求", message: error.message };
  return { title: "主题应用失败", message: error instanceof Error ? error.message : String(error) };
}

/** 供 useSyncExternalStore 使用的问题列表：快照引用只在有新问题时才变 */
export type ThemeIssueStore = {
  report(error: unknown): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ThemeIssue[];
};

export function createThemeIssueStore(): ThemeIssueStore {
  let issues: readonly ThemeIssue[] = [];
  const listeners = new Set<() => void>();
  return {
    report(error) {
      issues = [...issues, toThemeIssue(error)];
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => issues,
  };
}
