import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type { AdminGrant } from "@maillink/shared";
import { api } from "../../api/instance";
import { authQueryKeys } from "../../api/queries-auth";
import { nowSeconds } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout, FormDialog, TextField, useToast } from "../../ui";
import { buildGrantPatch, toDatetimeLocal } from "./grant-form";
import { RuleGroupSelect } from "./RuleGroupSelect";

type Props = { grant: AdminGrant; onClose: () => void };

function EditForm({ grant, onClose }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [ruleGroupId, setRuleGroupId] = useState(grant.rule_group_id);
  const [expiresLocal, setExpiresLocal] = useState(toDatetimeLocal(grant.expires_at));
  const [formError, setFormError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof api.patchGrant>[1]) => api.patchGrant(grant.id, patch),
    onSuccess: async () => {
      toast.success("授权已修改");
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.grants });
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const built = buildGrantPatch(grant, { ruleGroupId, expiresLocal }, nowSeconds());
    setFormError(built.ok ? undefined : built.error);
    if (built.ok) save.mutate(built.value);
  };
  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <RuleGroupSelect value={ruleGroupId} onChange={setRuleGroupId} idPrefix="grant-edit" />
      <TextField label="过期时间（可选）" type="datetime-local" value={expiresLocal} onChange={(event) => setExpiresLocal(event.target.value)}
        hint="留空表示不过期" />
      {formError ? <p className="field-error">{formError}</p> : null}
      {save.isError ? <ErrorCallout title="保存失败" {...describeError(save.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={save.isPending}>取消</Button>
        <Button type="submit" variant="primary" busy={save.isPending} busyLabel="保存中…">保存</Button>
      </div>
    </form>
  );
}

export function GrantEditDialog(props: Props) {
  return (
    <FormDialog open onOpenChange={(open) => !open && props.onClose()} title="修改授权"
      description={`${props.grant.address}（用户 ${props.grant.username}）。换规则组不会重置“首次访问”计时。`}>
      <EditForm {...props} />
    </FormDialog>
  );
}
