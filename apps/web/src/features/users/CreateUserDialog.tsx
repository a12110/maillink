import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  adminUserCreateSchema,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@maillink/shared";
import type { UserRole } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { queryKeys } from "../../api/queries";
import { fieldErrorsFromZod } from "../../lib/forms";
import type { FieldErrors } from "../../lib/forms";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout, FormDialog, Segmented, TextField, useToast } from "../../ui";
import { ROLE_OPTIONS } from "./labels";

const FIELDS = ["username", "password", "display_name", "email"] as const;
type Field = (typeof FIELDS)[number];
type Values = Record<Field, string> & { role: UserRole };
const EMPTY: Values = { username: "", password: "", display_name: "", email: "", role: "user" };

/** 409 冲突落到对应字段；其余错误作为表单级提示 */
function conflictField(error: unknown): { field: Field; message: string } | null {
  if (isApiError(error, "username_taken")) return { field: "username", message: error.message };
  if (isApiError(error, "email_taken")) return { field: "email", message: error.message };
  return null;
}

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: number) => void };

function CreateUserForm({ onOpenChange, onCreated }: Omit<Props, "open">) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Values>(EMPTY);
  const [clientErrors, setClientErrors] = useState<FieldErrors<Field>>({});
  const create = useMutation({
    mutationFn: api.createUser,
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      toast.success(`已创建用户 ${user.username}`);
      onCreated(user.id);
      onOpenChange(false);
    },
  });
  const conflict = conflictField(create.error);

  const bind = (name: Field) => ({
    name,
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
    error: clientErrors[name] ?? (conflict?.field === name ? conflict.message : undefined),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = adminUserCreateSchema.safeParse(values);
    if (!parsed.success) {
      setClientErrors(fieldErrorsFromZod(parsed.error, FIELDS).fields);
      return;
    }
    setClientErrors({});
    create.mutate(parsed.data);
  };

  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <TextField label="用户名" autoComplete="off" autoFocus
        hint={`${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符，字母或数字开头，可含 . _ -`} {...bind("username")} />
      <TextField label="初始密码" type="password" autoComplete="new-password"
        hint={`至少 ${PASSWORD_MIN_LENGTH} 个字符，创建后由你告知用户`} {...bind("password")} />
      <TextField label="显示名（可选）" autoComplete="off" {...bind("display_name")} />
      <TextField label="邮箱（可选）" type="email" autoComplete="off" hint="仅作联系信息，不会发送邮件" {...bind("email")} />
      <Segmented legend="角色" name="create-role" value={values.role} options={ROLE_OPTIONS}
        onChange={(role) => setValues({ ...values, role })} />
      {create.isError && !conflict ? <ErrorCallout title="创建失败" {...describeError(create.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={() => onOpenChange(false)} disabled={create.isPending}>取消</Button>
        <Button type="submit" variant="primary" busy={create.isPending} busyLabel="创建中…">创建用户</Button>
      </div>
    </form>
  );
}

export function CreateUserDialog({ open, onOpenChange, onCreated }: Props) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="新建用户" description="创建后可在右侧详情里继续调整角色与登录方式。">
      <CreateUserForm onOpenChange={onOpenChange} onCreated={onCreated} />
    </FormDialog>
  );
}
