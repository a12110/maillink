import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type { GrantBatchResponse } from "@maillink/shared";
import { api } from "../../api/instance";
import { authQueryKeys } from "../../api/queries-auth";
import { queryKeys } from "../../api/queries";
import { nowSeconds } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { Button, Callout, ErrorCallout, FormDialog, Segmented, TextField, useToast } from "../../ui";
import { buildBatchRequest, reasonLabel, summarizeBatch } from "./grant-form";
import type { OnConflict } from "./grant-form";
import { MailboxPicker } from "./MailboxPicker";
import type { PickedMailboxes } from "./MailboxPicker";
import { RuleGroupSelect } from "./RuleGroupSelect";

type Props = { userId: number; username: string; onClose: () => void };

const CONFLICT_OPTIONS = [
  { value: "skip", label: "跳过已有授权" },
  { value: "update", label: "覆盖已有授权" },
] as const satisfies ReadonlyArray<{ value: OnConflict; label: string }>;

function BatchResult({ response, addresses }: { response: GrantBatchResponse; addresses: ReadonlyMap<number, string> }) {
  const problems = response.results.filter((item) => item.status === "failed" || item.status === "skipped");
  return (
    <>
      <Callout tone={response.summary.failed > 0 ? "warning" : "info"} title="授权完成">{summarizeBatch(response.summary)}</Callout>
      {problems.length > 0 ? (
        <ul className="batch-results" aria-label="未新增的授权">
          {problems.map((item) => (
            <li key={item.mailbox_id}>
              <span className="mono">{addresses.get(item.mailbox_id) ?? `#${item.mailbox_id}`}</span>：{item.reason === null ? item.status : reasonLabel(item.reason)}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function AddForm({ userId, username, onClose }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<PickedMailboxes>(new Map());
  const [ruleGroupId, setRuleGroupId] = useState<number | null>(null);
  const [expiresLocal, setExpiresLocal] = useState("");
  const [onConflict, setOnConflict] = useState<OnConflict>("skip");
  const [formError, setFormError] = useState<string | undefined>();
  const add = useMutation({
    mutationFn: api.batchGrants,
    onSuccess: async (response) => {
      toast.success(`已为 ${username} 授权：${summarizeBatch(response.summary)}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: authQueryKeys.grants }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
      ]);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const built = buildBatchRequest(userId, { mailboxIds: [...picked.keys()], ruleGroupId, expiresLocal, onConflict }, nowSeconds());
    setFormError(built.ok ? undefined : built.error);
    if (built.ok) add.mutate(built.value);
  };

  if (add.data) {
    return (
      <div className="dialog-form">
        <BatchResult response={add.data} addresses={picked} />
        <div className="dialog-actions"><Button variant="primary" onClick={onClose}>完成</Button></div>
      </div>
    );
  }
  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <MailboxPicker picked={picked} onChange={setPicked} />
      <RuleGroupSelect value={ruleGroupId} onChange={setRuleGroupId} idPrefix="grant-add" />
      <TextField label="过期时间（可选）" type="datetime-local" value={expiresLocal} onChange={(event) => setExpiresLocal(event.target.value)}
        hint="留空表示不过期；过期后该用户立即看不到这些邮箱" />
      <Segmented legend="已有授权的处理" name="grant-on-conflict" value={onConflict} options={CONFLICT_OPTIONS} onChange={setOnConflict}
        hint="同一用户对同一个地址只有一条授权。覆盖会改成这里选的规则组与过期时间。" />
      {formError ? <p className="field-error">{formError}</p> : null}
      {add.isError ? <ErrorCallout title="授权失败" {...describeError(add.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={add.isPending}>取消</Button>
        <Button type="submit" variant="primary" busy={add.isPending} busyLabel="授权中…">授权 {picked.size > 0 ? `${picked.size} 个地址` : ""}</Button>
      </div>
    </form>
  );
}

export function GrantAddDialog(props: Props) {
  return (
    <FormDialog open onOpenChange={(open) => !open && props.onClose()} title={`给 ${props.username} 授权邮箱`}
      description="选择收件地址与规则组。用户登录后在“我的邮件”里看到这些地址的邮件，内容受规则组约束。">
      <AddForm {...props} />
    </FormDialog>
  );
}
