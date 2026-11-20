import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { adminUserPatchSchema } from "@maillink/shared";
import type { AdminUser, AdminUserPatch, UserRole, UserStatus } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { queryKeys, sessionQuery } from "../../api/queries";
import { fieldErrorsFromZod } from "../../lib/forms";
import type { FieldErrors } from "../../lib/forms";
import { describeError } from "../../lib/messages";
import { Button, ConfirmDialog, ErrorCallout, Segmented, TextField, useToast } from "../../ui";
import { ROLE_OPTIONS, STATUS_OPTIONS } from "./labels";

const FIELDS = ["username", "display_name", "email"] as const;
type Field = (typeof FIELDS)[number];
type Values = Record<Field, string> & { role: UserRole; status: UserStatus };

function toValues(user: AdminUser): Values {
  return {
    username: user.username,
    display_name: user.display_name ?? "",
    email: user.email ?? "",
    role: user.role,
    status: user.status,
  };
}

/** 只提交改过的字段；后端对 role / status 的变化会使该用户全部会话失效 */
function diffPatch(user: AdminUser, values: Values): AdminUserPatch {
  const before = toValues(user);
  const patch: AdminUserPatch = {};
  if (values.username !== before.username) patch.username = values.username;
  if (values.display_name !== before.display_name) patch.display_name = values.display_name;
  if (values.email !== before.email) patch.email = values.email;
  if (values.role !== before.role) patch.role = values.role;
  if (values.status !== before.status) patch.status = values.status;
  return patch;
}

function fieldConflict(error: unknown, field: Field): string | undefined {
  if (field === "username" && isApiError(error, "username_taken")) return error.message;
  if (field === "email" && isApiError(error, "email_taken")) return error.message;
  return undefined;
}

type Props = { user: AdminUser };

function consequenceText(isSelf: boolean): string {
  const base = "角色或状态变更后，该用户的全部会话会失效，需要重新登录。";
  return isSelf ? `${base}这是你自己的账号，保存后你也会被退出登录。` : base;
}

export function ProfileSection({ user }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const currentUserId = useQuery(sessionQuery()).data?.user.id;
  const [values, setValues] = useState<Values>(() => toValues(user));
  const [clientErrors, setClientErrors] = useState<FieldErrors<Field>>({});
  const [confirming, setConfirming] = useState<AdminUserPatch | null>(null);
  const patch = diffPatch(user, values);
  const dirty = Object.keys(patch).length > 0;

  const save = useMutation({
    mutationFn: (body: AdminUserPatch) => api.patchUser(user.id, body),
    onSuccess: async (updated) => {
      setValues(toValues(updated));
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      toast.success("用户资料已保存");
    },
    onSettled: () => setConfirming(null),
  });

  const bind = (name: Field) => ({
    name,
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
    error: clientErrors[name] ?? fieldConflict(save.error, name),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = adminUserPatchSchema.safeParse(patch);
    if (!parsed.success) {
      setClientErrors(fieldErrorsFromZod(parsed.error, FIELDS).fields);
      return;
    }
    setClientErrors({});
    if (patch.role !== undefined || patch.status !== undefined) setConfirming(patch);
    else save.mutate(patch);
  };

  const unhandled = save.isError && !FIELDS.some((f) => fieldConflict(save.error, f));
  return (
    <section className="panel-section" aria-labelledby="profile-title">
      <h3 className="section-title" id="profile-title">资料与角色</h3>
      <form className="dialog-form" onSubmit={submit} noValidate>
        <TextField label="用户名" autoComplete="off" {...bind("username")} />
        <TextField label="显示名" autoComplete="off" {...bind("display_name")} />
        <TextField label="邮箱" type="email" autoComplete="off" {...bind("email")} />
        <Segmented legend="角色" name={`role-${user.id}`} value={values.role} options={ROLE_OPTIONS}
          onChange={(role) => setValues({ ...values, role })} />
        <Segmented legend="状态" name={`status-${user.id}`} value={values.status} options={STATUS_OPTIONS}
          onChange={(status) => setValues({ ...values, status })}
          hint="角色或状态变更会使该用户的全部会话失效。" />
        {unhandled ? <ErrorCallout title="保存被拒绝" {...describeError(save.error)} /> : null}
        <div className="form-actions">
          <Button type="submit" disabled={!dirty} busy={save.isPending && confirming === null} busyLabel="保存中…">保存修改</Button>
        </div>
      </form>
      <ConfirmDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}
        title="确认变更角色或状态？" consequence={consequenceText(currentUserId === user.id)}
        confirmLabel="确认变更" busyLabel="保存中…" variant="primary" busy={save.isPending}
        onConfirm={() => confirming && save.mutate(confirming)} />
    </section>
  );
}
