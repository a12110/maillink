import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { updateMeRequestSchema } from "@maillink/shared";
import type { MeResponse } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { queryKeys } from "../../api/queries";
import { fieldErrorsFromZod } from "../../lib/forms";
import type { FieldErrors } from "../../lib/forms";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout, TextField, useToast } from "../../ui";

const FIELDS = ["display_name", "email"] as const;
type Field = (typeof FIELDS)[number];

export function ProfileSection({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Record<Field, string>>({ display_name: me.display_name ?? "", email: me.email ?? "" });
  const [clientErrors, setClientErrors] = useState<FieldErrors<Field>>({});
  const dirty = values.display_name !== (me.display_name ?? "") || values.email !== (me.email ?? "");

  const save = useMutation({
    mutationFn: api.updateMe,
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.me, updated);
      // 侧栏的显示名来自会话
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      toast.success("资料已保存");
    },
  });
  const emailConflict = isApiError(save.error, "email_taken") ? save.error.message : undefined;

  const bind = (name: Field) => ({
    name,
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
    error: clientErrors[name] ?? (name === "email" ? emailConflict : undefined),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = updateMeRequestSchema.safeParse(values);
    if (!parsed.success) {
      setClientErrors(fieldErrorsFromZod(parsed.error, FIELDS).fields);
      return;
    }
    setClientErrors({});
    save.mutate(values);
  };

  return (
    <section aria-labelledby="profile-title">
      <h2 className="section-heading" id="profile-title">资料</h2>
      <p className="section-lead">用户名 <span className="mono">{me.username}</span> 不能自行修改，需要改名请联系管理员。</p>
      <form className="form-stack" onSubmit={submit} noValidate>
        <TextField label="显示名" autoComplete="name" {...bind("display_name")} />
        <TextField label="邮箱" type="email" autoComplete="email" hint="仅作联系信息，不会发送邮件" {...bind("email")} />
        {save.isError && !emailConflict ? <ErrorCallout title="保存失败" {...describeError(save.error)} /> : null}
        <div className="form-actions">
          <Button type="submit" disabled={!dirty} busy={save.isPending} busyLabel="保存中…">保存资料</Button>
        </div>
      </form>
    </section>
  );
}
