import { useId } from "react";
import type { ViewMode } from "@maillink/shared";
import type { RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { Callout, Segmented } from "../../../ui";
import { fullViewBlockers } from "../config";
import { issuesAt } from "../issues";
import { VIEW_LABEL } from "../labels";
import { FieldIssues } from "./FieldIssues";

type Props = { config: RuleGroupConfig; issues: readonly RuleGroupIssue[]; onChange: (update: (c: RuleGroupConfig) => RuleGroupConfig) => void };

const VIEW_ORDER: readonly ViewMode[] = ["full", "text", "code_only", "meta_only"];

const VIEW_HINT: Record<ViewMode, string> = {
  full: "清洗后的 HTML（可切纯文本），附件按配置。",
  text: "只显示纯文本，列表可带预览。",
  code_only: "只显示验证码或登录链接，没有详情；没提取到的邮件不显示。",
  meta_only: "只显示发件人、主题、时间，没有详情。",
};

const FULL_VIEW_CODES = new Set(["full_view_with_redaction", "full_view_with_link_filter"]);

/** 互斥约束的原因：不是悄悄置灰，而是写出为什么、怎么解（删脱敏 / 改链接） */
function FullViewConstraint({ config, id, onChange }: { config: RuleGroupConfig; id: string; onChange: Props["onChange"] }) {
  const blockers = fullViewBlockers(config);
  if (blockers.length === 0) return null;
  const isFull = config.present.view === "full";
  const title = isFull ? "当前不能用“完整”视图：" : "“完整”暂时不能选：";
  return (
    <div id={id} className="constraint">
      <Callout tone={isFull ? "danger" : "warning"} title={`${title}${blockers.join("，")}。`}
        actions={
          <>
            {config.present.redact.length > 0 ? (
              <button type="button" className="text-action" onClick={() => onChange((c) => ({ ...c, present: { ...c.present, redact: [] } }))}>删除脱敏规则</button>
            ) : null}
            {config.present.links !== "keep" ? (
              <button type="button" className="text-action" onClick={() => onChange((c) => ({ ...c, present: { ...c.present, links: "keep" } }))}>把链接改回“保留”</button>
            ) : null}
          </>
        }>
        完整视图显示的是清洗后的 HTML，文字会被标签切开（如 12&lt;b&gt;34&lt;/b&gt;），在 HTML 上做替换或改写链接不可靠，可能漏掉该脱敏的内容。所以脱敏和改写链接只能配合纯文本或更严格的视图。
      </Callout>
    </div>
  );
}

export function ViewField({ config, issues, onChange }: Props) {
  const reasonId = useId();
  const { view } = config.present;
  const blocked = fullViewBlockers(config).length > 0;
  const options = VIEW_ORDER.map((value) => ({ value, label: VIEW_LABEL[value], locked: value === "full" && blocked && view !== "full" }));
  const own = issuesAt(issues, ["present", "view"]).filter((issue) => !FULL_VIEW_CODES.has(issue.code));
  return (
    <div className="stack">
      <Segmented legend="视图模式" hideLegend name="present-view" value={view} options={options} hint={VIEW_HINT[view]} lockedReasonId={reasonId}
        onChange={(next) => onChange((c) => ({ ...c, present: { ...c.present, view: next } }))} onLockedSelect={() => document.getElementById(reasonId)?.scrollIntoView?.({ block: "nearest" })} />
      <FullViewConstraint config={config} id={reasonId} onChange={onChange} />
      <FieldIssues issues={own} />
    </div>
  );
}
