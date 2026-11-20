import type { ReactNode } from "react";
import type { RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { ExtractField } from "./ExtractField";
import { AttachmentRow, LinksRow, RecipientRow, SenderRow, SnippetRow } from "./PresentRows";
import { RedactSection } from "./RedactSection";
import { ViewField } from "./ViewField";

type Props = { config: RuleGroupConfig; issues: readonly RuleGroupIssue[]; onChange: (update: (c: RuleGroupConfig) => RuleGroupConfig) => void };

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="setting-row" role="group" aria-label={label}>
      <span className="label" aria-hidden="true">{label}</span>
      {children}
    </div>
  );
}

/** ③ 呈现：决定能看到的邮件“显示多少”（02 §4） */
export function PresentSection(props: Props) {
  return (
    <section aria-labelledby="s-present">
      <h2 className="section-title" id="s-present"><span className="idx">3</span>呈现</h2>
      <p className="section-lead">决定能看到的邮件“显示多少”。</p>
      <SettingRow label="视图模式"><ViewField {...props} /></SettingRow>
      <SettingRow label="验证码提取"><ExtractField {...props} /></SettingRow>
      <SettingRow label="发件人显示"><SenderRow {...props} /></SettingRow>
      <SettingRow label="收件地址显示"><RecipientRow {...props} /></SettingRow>
      <SettingRow label="链接与图片"><LinksRow {...props} /></SettingRow>
      <SettingRow label="附件"><AttachmentRow {...props} /></SettingRow>
      <SettingRow label="列表正文预览"><SnippetRow {...props} /></SettingRow>
      <SettingRow label="脱敏规则"><RedactSection {...props} /></SettingRow>
    </section>
  );
}
