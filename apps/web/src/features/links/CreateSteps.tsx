import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { SHARE_LINK_LIMITS } from "@maillink/shared";
import type { AdminRuleGroupSummary } from "@maillink/shared";
import { linkRuleGroupChoicesQuery } from "../../api/links-queries";
import { describeError } from "../../lib/messages";
import { Callout, ErrorCallout, Segmented } from "../../ui";
import { MailboxPicker } from "./MailboxPicker";
import type { CreateDraft, CreateMode, FieldErrors } from "./create-form";

type StepProps = { draft: CreateDraft; errors: FieldErrors; onChange: (patch: Partial<CreateDraft>) => void };

const VIEW_LABEL: Record<string, string> = { code_only: "仅验证码", text: "纯文本", full: "完整邮件", meta_only: "仅元信息" };

/** 第 1 步：选收件地址 + 一址一链 / 合并为一链 */
export function AddressesStep({ draft, errors, onChange }: StepProps) {
  const combinedTooMany = draft.mode === "combined" && draft.mailboxes.length > SHARE_LINK_LIMITS.mailboxesPerLink;
  const count = draft.mailboxes.length;
  const hint =
    draft.mode === "per_mailbox"
      ? `为每个地址各生成一个链接${count > 0 ? `（现在选了 ${count} 个，将生成 ${count} 个链接）` : ""}。卖账号的常规做法。`
      : `所有地址放进同一个链接（最多 ${SHARE_LINK_LIMITS.mailboxesPerLink} 个），买家在一个页面里看到这些地址的邮件。`;
  return (
    <div className="step-body">
      <MailboxPicker value={draft.mailboxes} onChange={(mailboxes) => onChange({ mailboxes })} max={SHARE_LINK_LIMITS.createMaxMailboxes} />
      {draft.mailboxes.some((item) => item.address === null) ? <p className="field-hint">带 # 的是从收件地址页带过来的预选地址，创建后在链接详情里能看到具体地址。</p> : null}
      {errors.mailboxes ? <p className="field-error">{errors.mailboxes}</p> : null}
      <Segmented<CreateMode>
        legend="生成方式"
        name="create-mode"
        value={draft.mode}
        options={[
          { value: "per_mailbox", label: "一址一链" },
          { value: "combined", label: "合并为一链" },
        ]}
        onChange={(mode) => onChange({ mode })}
        hint={hint}
      />
      {combinedTooMany ? <p className="field-error">合并为一链最多 {SHARE_LINK_LIMITS.mailboxesPerLink} 个地址，请减少选择或改用“一址一链”。</p> : null}
    </div>
  );
}

function RuleGroupChoice({ group, checked, onPick }: { group: AdminRuleGroupSummary; checked: boolean; onPick: () => void }) {
  return (
    <li>
      <label className="choice" data-disabled={group.invalid}>
        <input type="radio" name="create-rule-group" checked={checked} disabled={group.invalid} onChange={onPick} />
        <span className="choice-main">
          <b>{group.name}</b>
          <span className="dim">
            {group.view ? VIEW_LABEL[group.view] : "—"} · 已被 {group.link_count} 个链接使用
          </span>
          {group.description ? <span className="field-hint">{group.description}</span> : null}
          {group.invalid ? (
            <span className="field-error">
              <Lock className="inline-icon" aria-hidden="true" />
              配置无效（{group.invalid_code ?? "invalid"}），引用它的链接会全部不可见，不能选择。请先修好规则组。
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}

/** 第 2 步：选规则组 */
export function RuleGroupStep({ draft, errors, onChange }: StepProps) {
  const groups = useQuery(linkRuleGroupChoicesQuery());
  if (groups.isError) return <ErrorCallout title="规则组加载失败" {...describeError(groups.error)} onRetry={() => void groups.refetch()} />;
  if (groups.isPending) return <span className="skeleton" aria-label="加载中" />;
  if (groups.data.items.length === 0) {
    return <Callout tone="warning" title="还没有规则组">链接必须绑定一个规则组来决定买家能看到哪些邮件。请先到“规则组”页创建。</Callout>;
  }
  return (
    <div className="step-body">
      <p className="section-lead">规则组决定买家能看到哪些邮件、怎么显示（仅验证码 / 纯文本 / 完整邮件）。</p>
      <ul className="choice-list">
        {groups.data.items.map((group) => (
          <RuleGroupChoice key={group.id} group={group} checked={draft.ruleGroupId === group.id} onPick={() => onChange({ ruleGroupId: group.id })} />
        ))}
      </ul>
      {errors.ruleGroupId ? <p className="field-error">{errors.ruleGroupId}</p> : null}
    </div>
  );
}
