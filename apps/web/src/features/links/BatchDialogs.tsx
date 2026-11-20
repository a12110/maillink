import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type { ShareLinkBatch } from "@maillink/shared";
import { api } from "../../api/instance";
import { linkRuleGroupChoicesQuery } from "../../api/links-queries";
import { describeError } from "../../lib/messages";
import { Button, ConfirmDialog, ErrorCallout, FormDialog, Select, TextField } from "../../ui";
import { buildBatch, parseExtend, summarizeBatch } from "./batch";
import type { BatchSummary } from "./batch";
import { EXTEND_UNITS } from "./labels";
import type { ExtendUnit } from "./labels";

type BatchDialogProps = {
  ids: number[];
  onClose: () => void;
  /** 批量接口已返回（逐条结果）；调用方负责刷新列表与提示 */
  onDone: (summary: BatchSummary) => void;
};

function useBatch(onDone: BatchDialogProps["onDone"]) {
  return useMutation({
    mutationFn: (body: ShareLinkBatch) => api.batchLinks(body),
    onSuccess: (response) => onDone(summarizeBatch(response)),
  });
}

const subject = (ids: number[]) => (ids.length === 1 ? "这个链接" : `选中的 ${ids.length} 个链接`);

export function ExtendDialog({ ids, onClose, onDone }: BatchDialogProps) {
  const [amount, setAmount] = useState("7");
  const [unit, setUnit] = useState<ExtendUnit>("day");
  const [error, setError] = useState<string | null>(null);
  const batch = useBatch(onDone);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseExtend({ amount, unit });
    if (!parsed.ok) return setError(parsed.error);
    setError(null);
    batch.mutate(buildBatch.extend(ids, parsed.seconds));
  };
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title="延长有效期" description={`在${subject(ids)}当前的截止时间上顺延（已过期的从现在算起）。没有截止时间的链接无法延长。`}>
      <form className="dialog-form" onSubmit={submit} noValidate>
        <div className="inline-fields">
          <TextField label="延长" inputMode="numeric" value={amount} error={error ?? undefined} onChange={(event) => setAmount(event.target.value)} />
          <div className="field">
            <label className="field-label" htmlFor="extend-unit">单位</label>
            <Select id="extend-unit" value={unit} onChange={(event) => setUnit(EXTEND_UNITS.find((u) => u.value === event.target.value)?.value ?? "day")}>
              {EXTEND_UNITS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </Select>
          </div>
        </div>
        {batch.isError ? <ErrorCallout title="延长失败" {...describeError(batch.error)} /> : null}
        <div className="dialog-actions">
          <Button onClick={onClose} disabled={batch.isPending}>取消</Button>
          <Button type="submit" variant="primary" busy={batch.isPending} busyLabel="延长中…">延长有效期</Button>
        </div>
      </form>
    </FormDialog>
  );
}

export function RuleGroupDialog({ ids, onClose, onDone }: BatchDialogProps) {
  const groups = useQuery(linkRuleGroupChoicesQuery());
  const [choice, setChoice] = useState("");
  const batch = useBatch(onDone);
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title="换规则组" description={`把${subject(ids)}改用另一个规则组，立即生效；访问者看到的邮件范围随之改变。`}>
      <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); if (choice !== "") batch.mutate(buildBatch.setRuleGroup(ids, Number(choice))); }}>
        <div className="field">
          <label className="field-label" htmlFor="batch-rule-group">新的规则组</label>
          <Select id="batch-rule-group" block value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value="">请选择…</option>
            {groups.data?.items.map((group) => (
              <option key={group.id} value={group.id} disabled={group.invalid}>
                {group.name}{group.invalid ? "（配置无效）" : ""}
              </option>
            ))}
          </Select>
          {groups.isError ? <p className="field-error">规则组加载失败：{describeError(groups.error).message}</p> : null}
        </div>
        {batch.isError ? <ErrorCallout title="换规则组失败" {...describeError(batch.error)} /> : null}
        <div className="dialog-actions">
          <Button onClick={onClose} disabled={batch.isPending}>取消</Button>
          <Button type="submit" variant="primary" disabled={choice === ""} busy={batch.isPending} busyLabel="保存中…">换规则组</Button>
        </div>
      </form>
    </FormDialog>
  );
}

/** 撤销是终态：二次确认并写明后果 */
export function RevokeDialog({ ids, onClose, onDone }: BatchDialogProps) {
  const batch = useBatch(onDone);
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`撤销${subject(ids)}？`}
      consequence={`撤销后，持有这${ids.length === 1 ? "个" : "些"}链接的买家立即看到“链接已失效”。撤销是终态，不可恢复；需要继续使用只能新建链接。`}
      confirmLabel="撤销链接"
      busyLabel="撤销中…"
      busy={batch.isPending}
      error={batch.isError ? describeError(batch.error) : null}
      onConfirm={() => batch.mutate(buildBatch.revoke(ids))}
    />
  );
}

/** 批量里有没改动的：逐条列出原因（不用 toast 吞掉） */
export function BatchResultDialog({ title, summary, labelOf, onClose }: { title: string; summary: BatchSummary; labelOf: (id: number) => string; onClose: () => void }) {
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={`成功 ${summary.ok} 条，没有改动 ${summary.failed.length} 条。`}
      footer={<Button variant="primary" onClick={onClose}>知道了</Button>}
    >
      <ul className="result-list">
        {summary.failed.map((item) => (
          <li key={item.id}>
            <b>{labelOf(item.id)}</b>
            <span>{item.message}</span>
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}
