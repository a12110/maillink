import { useMemo, useState } from "react";
import type { RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { asFormConfig } from "../config";
import { countEditorChanges, mergeIssues, parseJsonConfig, prettyJson, validateLive } from "./editor-state";
import type { EditorContent, EditorMode } from "./editor-state";

/** 编辑器状态：名称、说明、配置（表单与 JSON 共用同一份对象）、模式、服务端返回的额外问题 */
export function useRuleGroupEditor(initial: EditorContent, options: { unreadable?: boolean } = {}) {
  const [baseline, setBaseline] = useState(initial);
  const [content, setContent] = useState(initial);
  const [mode, setMode] = useState<EditorMode>(() => (asFormConfig(initial.config) ? "form" : "json"));
  const [jsonText, setJsonText] = useState(() => prettyJson(initial.config));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<RuleGroupIssue[]>([]);
  // 库里的配置不是合法 JSON：页面上是替代用的空白配置，必须允许直接保存覆盖，所以算作有 1 处改动，直到保存成功
  const [unreadable, setUnreadable] = useState(options.unreadable ?? false);

  const form = useMemo(() => asFormConfig(content.config), [content.config]);
  const localIssues = useMemo(() => validateLive(content.config), [content.config]);
  const issues = useMemo(() => mergeIssues(localIssues, serverIssues), [localIssues, serverIssues]);
  // JSON 文本有语法错误时，页面上的配置还是上一份能解析的，文本与配置不一致 = 有未保存的改动
  const changes = countEditorChanges(content, baseline) + (jsonError !== null ? 1 : 0) + (unreadable ? 1 : 0);

  const setConfig = (config: unknown) => {
    setContent((current) => ({ ...current, config }));
    setServerIssues([]);
  };
  const load = (next: EditorContent, keepUnreadable = false) => {
    if (!keepUnreadable) setUnreadable(false);
    setBaseline(next);
    setContent(next);
    setJsonText(prettyJson(next.config));
    setJsonError(null);
    setServerIssues([]);
    setMode(asFormConfig(next.config) ? "form" : "json");
  };
  return {
    content,
    form,
    issues,
    changes,
    mode,
    jsonText,
    jsonError,
    baseline,
    setName: (name: string) => setContent((current) => ({ ...current, name })),
    setDescription: (description: string) => setContent((current) => ({ ...current, description })),
    /** 表单里改配置：只在结构合法（form 非空）时可用 */
    edit: (update: (config: RuleGroupConfig) => RuleGroupConfig) => {
      if (form) setConfig(update(form));
    },
    editJson: (text: string) => {
      setJsonText(text);
      const parsed = parseJsonConfig(text);
      setJsonError(parsed.ok ? null : parsed.error);
      if (parsed.ok) setConfig(parsed.value);
    },
    /** 切到 JSON：用当前配置重新生成文本；切回表单：JSON 必须能解析且结构合法，否则留在 JSON 并说明原因 */
    switchMode: (target: EditorMode): string | null => {
      if (target === "json") {
        setJsonText(prettyJson(content.config));
        setJsonError(null);
        setMode("json");
        return null;
      }
      if (jsonError) return jsonError;
      if (!form) return "配置结构不合法（见下方问题清单），修好之后才能切回表单";
      setMode("form");
      return null;
    },
    discard: () => load(baseline, true),
    /** 保存成功或重新加载：以服务端返回的内容为新的基线 */
    rebase: (next: EditorContent) => load(next),
    setServerIssues,
  };
}

export type RuleGroupEditorState = ReturnType<typeof useRuleGroupEditor>;
