import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type { AdminMailbox, GrantBatchResponse } from "@maillink/shared";
import { api } from "../../api/instance";
import { authQueryKeys } from "../../api/queries-auth";
import { queryKeys } from "../../api/queries";
import { nowSeconds } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { Button, Callout, ErrorCallout, FormDialog, Segmented, Tag, TextField, useToast } from "../../ui";
import { summarizeBatch } from "../users/grant-form";
import type { OnConflict } from "../users/grant-form";
import { RuleGroupSelect } from "../users/RuleGroupSelect";
import { buildMultiGrantRequest, describeGrantResults } from "./grant-batch";
import { UserPicker } from "./UserPicker";
import type { PickedUsers } from "./UserPicker";

type Props = { mailboxes: ReadonlyMap<number, AdminMailbox>; onClose: () => void };

const CONFLICT_OPTIONS = [
  { value: "skip", label: "跳过已有授权" },
  { value: "update", label: "覆盖已有授权" },
] as const satisfies ReadonlyArray<{ value: OnConflict; label: string }>;

const TONE = { created: "success", updated: "info", skipped: undefined, failed: "danger" } as const;

/** 逐条结果：每对「用户 × 地址」一行，状态 + 原因（中文） */
function Results({ response, users, mailboxes }: { response: GrantBatchResponse; users: PickedUsers; mailboxes: ReadonlyMap<number, string> }) {
  const rows = describeGrantResults(response, users, mailboxes);
  return (
    <>
      <Callout tone={response.summary.failed > 0 ? "warning" : "info"} title="授权完成">{summarizeBatch(response.summary)}</Callout>
      <ul className="grant-results" aria-label="逐条结果">
        {rows.map((row) => (
          <li key={row.key} data-status={row.status}>
            <Tag tone={TONE[row.status]}>{row.label}</Tag>
            <span className="mono grant-who">{row.who}</span>
            {row.note ? <span className="dim">{row.note}</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function useGrantForm(mailboxes: ReadonlyMap<number, AdminMailbox>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [users, setUsers] = useState<PickedUsers>(new Map());
  const [ruleGroupId, setRuleGroupId] = useState<number | null>(null);
  const [expiresLocal, setExpiresLocal] = useState("");
  const [onConflict, setOnConflict] = useState<OnConflict>("skip");
  const [formError, setFormError] = useState<string | undefined>();
  const grant = useMutation({
    mutationFn: api.batchGrants,
    onSuccess: async (response) => {
      toast.success(`授权完成：${summarizeBatch(response.summary)}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: authQueryKeys.grants }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminMailboxes }),
      ]);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const built = buildMultiGrantRequest({ userIds: [...users.keys()], mailboxIds: [...mailboxes.keys()], ruleGroupId, expiresLocal, onConflict }, nowSeconds());
    setFormError(built.ok ? undefined : built.error);
    if (built.ok) grant.mutate(built.value);
  };
  return { users, setUsers, ruleGroupId, setRuleGroupId, expiresLocal, setExpiresLocal, onConflict, setOnConflict, formError, grant, submit };
}

function GrantForm({ mailboxes, onClose }: Props) {
  const form = useGrantForm(mailboxes);
  const { grant } = form;
  const addresses = new Map([...mailboxes].map(([id, mailbox]) => [id, mailbox.address]));
  const disabledCount = [...mailboxes.values()].filter((mailbox) => mailbox.status === "disabled").length;
  if (grant.data) {
    return (
      <div className="dialog-form">
        <Results response={grant.data} users={form.users} mailboxes={addresses} />
        <div className="dialog-actions"><Button variant="primary" onClick={onClose}>完成</Button></div>
      </div>
    );
  }
  return (
    <form className="dialog-form" onSubmit={form.submit} noValidate>
      {disabledCount > 0 ? <Callout tone="warning" title={`选中的地址里有 ${disabledCount} 个已停用`}>授权可以建立，但地址启用之前用户看不到它的邮件。</Callout> : null}
      <UserPicker picked={form.users} onChange={form.setUsers} />
      <RuleGroupSelect value={form.ruleGroupId} onChange={form.setRuleGroupId} idPrefix="grant-users" />
      <TextField label="过期时间（可选）" type="datetime-local" value={form.expiresLocal} onChange={(event) => form.setExpiresLocal(event.target.value)} hint="留空表示不过期；过期后这些用户立即看不到这些邮箱" />
      <Segmented legend="已有授权的处理" name="grant-users-conflict" value={form.onConflict} options={CONFLICT_OPTIONS} onChange={form.setOnConflict} hint="同一用户对同一个地址只有一条授权。覆盖会改成这里选的规则组与过期时间。" />
      {form.formError ? <p className="field-error">{form.formError}</p> : null}
      {grant.isError ? <ErrorCallout title="授权失败" {...describeError(grant.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={grant.isPending}>取消</Button>
        <Button type="submit" variant="primary" busy={grant.isPending} busyLabel="授权中…">授权 {form.users.size} 个用户</Button>
      </div>
    </form>
  );
}

/** 收件地址页批量栏的「授权给用户」：选中的地址 × 选中的用户，一次最多 1000 对（后端上限） */
export function GrantUsersDialog(props: Props) {
  return (
    <FormDialog open onOpenChange={(open) => !open && props.onClose()} title={`授权 ${props.mailboxes.size} 个地址给用户`} description="用户登录后在“我的邮件”里看到这些地址的邮件，内容受规则组约束。">
      <GrantForm {...props} />
    </FormDialog>
  );
}
