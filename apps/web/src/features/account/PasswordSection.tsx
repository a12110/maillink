import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { changePasswordRequestSchema, PASSWORD_MIN_LENGTH } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { queryKeys } from "../../api/queries";
import { fieldErrorsFromZod } from "../../lib/forms";
import type { FieldErrors } from "../../lib/forms";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout, TextField, useToast } from "../../ui";

const FIELDS = ["current_password", "new_password", "confirm"] as const;
type Field = (typeof FIELDS)[number];
const EMPTY: Record<Field, string> = { current_password: "", new_password: "", confirm: "" };

export function PasswordSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState(EMPTY);
  const [clientErrors, setClientErrors] = useState<FieldErrors<Field>>({});
  const change = useMutation({
    mutationFn: api.changePassword,
    onSuccess: async () => {
      setValues(EMPTY);
      toast.success("密码已修改，其他设备上的登录会话已失效");
      await queryClient.invalidateQueries({ queryKey: queryKeys.mySessions });
    },
  });
  const wrongCurrent = isApiError(change.error, "invalid_current_password") ? change.error.message : undefined;

  const bind = (name: Field) => ({
    name,
    type: "password",
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
    error: clientErrors[name] ?? (name === "current_password" ? wrongCurrent : undefined),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = changePasswordRequestSchema.safeParse(values);
    const errors = parsed.success ? {} : fieldErrorsFromZod(parsed.error, FIELDS).fields;
    if (values.confirm !== values.new_password) errors.confirm = "两次输入的新密码不一致";
    setClientErrors(errors);
    if (parsed.success && !errors.confirm) change.mutate(parsed.data);
  };

  return (
    <section aria-labelledby="password-title">
      <h2 className="section-heading" id="password-title">密码</h2>
      <p className="section-lead">修改密码后，除当前设备外的所有登录会话都会失效。</p>
      <form className="form-stack" onSubmit={submit} noValidate>
        <TextField label="当前密码" autoComplete="current-password" {...bind("current_password")} />
        <TextField label="新密码" autoComplete="new-password" hint={`至少 ${PASSWORD_MIN_LENGTH} 个字符`} {...bind("new_password")} />
        <TextField label="确认新密码" autoComplete="new-password" {...bind("confirm")} />
        {change.isError && !wrongCurrent ? <ErrorCallout title="修改失败" {...describeError(change.error)} /> : null}
        <div className="form-actions">
          <Button type="submit" busy={change.isPending} busyLabel="修改中…">修改密码</Button>
        </div>
      </form>
    </section>
  );
}
