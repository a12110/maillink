import { useId } from "react";
import type { PresentConfig, RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { ChipInput, Select, Switch } from "../../../ui";
import { issuesAt } from "../issues";
import { FieldIssues } from "./FieldIssues";

type Change = (update: (c: RuleGroupConfig) => RuleGroupConfig) => void;
type RowProps = { config: RuleGroupConfig; issues: readonly RuleGroupIssue[]; onChange: Change };

const setPresent = (onChange: Change, patch: Partial<PresentConfig>) => onChange((c) => ({ ...c, present: { ...c.present, ...patch } }));

const SENDER_OPTIONS: ReadonlyArray<[PresentConfig["sender"], string]> = [
  ["full", "完整地址"],
  ["domain", "只显示域名"],
  ["name", "只显示名称"],
  ["hidden", "隐藏"],
];
const RECIPIENT_OPTIONS: ReadonlyArray<[PresentConfig["recipient"], string]> = [
  ["full", "完整显示"],
  ["masked", "打码（ab***@icloud.com）"],
  ["hidden", "隐藏"],
];
const ATTACHMENT_OPTIONS: ReadonlyArray<[PresentConfig["attachments"], string]> = [
  ["hidden", "隐藏"],
  ["list", "只列文件名"],
  ["download", "可下载"],
];

type LinkMode = "keep" | "strip" | "allow";

function linkMode(links: PresentConfig["links"]): LinkMode {
  return typeof links === "object" ? "allow" : links;
}

export function SenderRow({ config, onChange }: RowProps) {
  return (
    <Select aria-label="发件人显示" value={config.present.sender} onChange={(event) => setPresent(onChange, { sender: event.target.value as PresentConfig["sender"] })}>
      {SENDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select>
  );
}

export function RecipientRow({ config, onChange }: RowProps) {
  return (
    <div className="stack">
      <Select aria-label="收件地址显示" value={config.present.recipient} onChange={(event) => setPresent(onChange, { recipient: event.target.value as PresentConfig["recipient"] })}>
        {RECIPIENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <p className="field-hint">共享号的别名就是登录邮箱，买家需要核对时显示完整；对外分发不想暴露别名时打码或隐藏。</p>
    </div>
  );
}

export function AttachmentRow({ config, onChange }: RowProps) {
  return (
    <Select aria-label="附件" value={config.present.attachments} onChange={(event) => setPresent(onChange, { attachments: event.target.value as PresentConfig["attachments"] })}>
      {ATTACHMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select>
  );
}

/** 链接与图片：链接保留 / 全部移除 / 只保留指定域名（带域名输入）+ 远程图片 */
export function LinksRow({ config, issues, onChange }: RowProps) {
  const { links, remote_images } = config.present;
  const mode = linkMode(links);
  const domains = typeof links === "object" ? links.allow_domains : [];
  const own = issuesAt(issues, ["present", "links"]);
  const domainError = (_value: string, index: number) => issuesAt(issues, ["present", "links", "allow_domains", index]).find((i) => i.severity === "error")?.message;
  return (
    <div className="stack">
      <div className="row-inline">
        <Select aria-label="链接" value={mode} onChange={(event) => {
          const next = event.target.value as LinkMode;
          setPresent(onChange, { links: next === "allow" ? { allow_domains: domains } : next });
        }}>
          <option value="keep">链接：保留</option>
          <option value="strip">链接：全部移除</option>
          <option value="allow">链接：只保留指定域名</option>
        </Select>
        <Select aria-label="远程图片" value={remote_images} onChange={(event) => setPresent(onChange, { remote_images: event.target.value as PresentConfig["remote_images"] })}>
          <option value="block">远程图片：阻止</option>
          <option value="allow">远程图片：允许</option>
        </Select>
      </div>
      {mode === "allow" ? (
        <div className="stack-fill">
          <ChipInput values={domains} aria-label="允许的链接域名" placeholder="例如 openai.com，按 Enter 添加" itemError={domainError}
            invalid={own.some((issue) => issue.severity === "error")} onChange={(next) => setPresent(onChange, { links: { allow_domains: next } })} />
          <p className="field-hint">按点号边界匹配：openai.com 也覆盖 auth.openai.com。</p>
        </div>
      ) : null}
      {remote_images === "allow" ? <p className="field-hint">允许远程图片会让发件方通过图片请求得知访客的 IP 与打开时间。</p> : null}
      <FieldIssues issues={own.filter((issue) => issue.path.length <= 3)} />
    </div>
  );
}

export function SnippetRow({ config, onChange }: RowProps) {
  const whyId = useId();
  const { view, snippet } = config.present;
  const unavailable = view === "code_only" || view === "meta_only";
  return (
    <div className="row-inline">
      <Switch aria-label="列表带正文预览" aria-describedby={whyId} checked={snippet} disabled={unavailable} onChange={(event) => setPresent(onChange, { snippet: event.target.checked })} />
      <span className="field-hint" id={whyId}>
        {unavailable ? `“${view === "code_only" ? "仅验证码" : "仅元信息"}”视图的列表没有正文预览，这个开关不生效。` : "列表里每封邮件下面显示正文开头一小段。"}
      </span>
    </div>
  );
}
