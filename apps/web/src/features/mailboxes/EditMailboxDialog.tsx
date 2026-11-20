import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { MAILBOX_LIMITS, mailboxPatchSchema, mailboxTagSchema } from "@maillink/shared";
import type { AdminMailbox, MailboxPatch, MailboxStatus } from "@maillink/shared";
import { api } from "../../api/instance";
import { queryKeys } from "../../api/queries";
import { describeError } from "../../lib/messages";
import { Button, ChipInput, ErrorCallout, FormDialog, Segmented, TextField, useToast } from "../../ui";
import { STATUS_LABEL } from "./labels";

type Values = { label: string; note: string; tags: string[]; status: MailboxStatus };

function toValues(mailbox: AdminMailbox): Values {
  return { label: mailbox.label ?? "", note: mailbox.note ?? "", tags: [...mailbox.tags], status: mailbox.status };
}

/** 只提交改过的字段；空串表示清空（null） */
export function diffMailboxPatch(mailbox: AdminMailbox, values: Values): MailboxPatch {
  const before = toValues(mailbox);
  const patch: MailboxPatch = {};
  if (values.label !== before.label) patch.label = values.label.trim() === "" ? null : values.label;
  if (values.note !== before.note) patch.note = values.note.trim() === "" ? null : values.note;
  if (values.status !== before.status) patch.status = values.status;
  if (JSON.stringify(values.tags) !== JSON.stringify(before.tags)) patch.tags = values.tags;
  return patch;
}

function tagError(tag: string): string | undefined {
  const parsed = mailboxTagSchema.safeParse(tag);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

function EditForm({ mailbox, onClose }: { mailbox: AdminMailbox; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Values>(() => toValues(mailbox));
  const patch = diffMailboxPatch(mailbox, values);
  const parsed = Object.keys(patch).length === 0 ? null : mailboxPatchSchema.safeParse(patch);
  const save = useMutation({
    mutationFn: (body: MailboxPatch) => api.patchMailbox(mailbox.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminMailboxes });
      toast.success(`已保存 ${mailbox.address}`);
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed?.success) save.mutate(parsed.data);
  };
  const problem = parsed && !parsed.success ? parsed.error.issues[0]?.message : undefined;
  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <TextField label="名称（可选）" value={values.label} maxLength={MAILBOX_LIMITS.labelMaxLength} onChange={(e) => setValues({ ...values, label: e.target.value })} />
      <TextField label="备注（可选）" value={values.note} maxLength={MAILBOX_LIMITS.noteMaxLength} onChange={(e) => setValues({ ...values, note: e.target.value })} />
      <div className="field">
        <span className="field-label">标签</span>
        <ChipInput values={values.tags} onChange={(tags) => setValues({ ...values, tags })} aria-label="标签" placeholder="输入后按 Enter 添加" mono={false} itemError={tagError} />
        <p className="field-hint">最多 {MAILBOX_LIMITS.tagsPerMailbox} 个，不能含空白、逗号、分号或竖线。</p>
      </div>
      <Segmented
        legend="状态"
        name="mailbox-status"
        value={values.status}
        options={[{ value: "active", label: STATUS_LABEL.active }, { value: "disabled", label: STATUS_LABEL.disabled }]}
        onChange={(status) => setValues({ ...values, status })}
        hint="停用不会删除这个地址上的链接与授权，可随时重新启用。"
      />
      {problem ? <p className="field-error">{problem}</p> : null}
      {save.isError ? <ErrorCallout title="保存失败" {...describeError(save.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={save.isPending}>取消</Button>
        <Button type="submit" variant="primary" busy={save.isPending} busyLabel="保存中…" disabled={parsed === null || !parsed.success}>保存</Button>
      </div>
    </form>
  );
}

export function EditMailboxDialog({ mailbox, onClose }: { mailbox: AdminMailbox | null; onClose: () => void }) {
  return (
    <FormDialog
      open={mailbox !== null}
      onOpenChange={(open) => !open && onClose()}
      title="编辑收件地址"
      description={mailbox ? `${mailbox.address} 的名称、备注、标签与状态。地址本身不能修改。` : ""}
    >
      {mailbox ? <EditForm key={mailbox.id} mailbox={mailbox} onClose={onClose} /> : null}
    </FormDialog>
  );
}
