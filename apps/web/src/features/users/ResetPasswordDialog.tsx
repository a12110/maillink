import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { adminPasswordResetSchema, PASSWORD_MIN_LENGTH } from "@maillink/shared";
import { api } from "../../api/instance";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout, FormDialog, TextField, useToast } from "../../ui";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; userId: number; username: string };

function ResetPasswordForm({ onOpenChange, userId, username }: Omit<Props, "open">) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const reset = useMutation({
    mutationFn: (value: string) => api.resetUserPassword(userId, { password: value }),
    onSuccess: () => {
      toast.success(`已重置 ${username} 的密码，其全部会话已失效`);
      onOpenChange(false);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = adminPasswordResetSchema.safeParse({ password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    reset.mutate(parsed.data.password);
  };

  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <TextField label="新密码" type="password" autoComplete="new-password" autoFocus value={password}
        onChange={(event) => setPassword(event.target.value)} error={error}
        hint={`至少 ${PASSWORD_MIN_LENGTH} 个字符`} />
      {reset.isError ? <ErrorCallout title="重置失败" {...describeError(reset.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={() => onOpenChange(false)} disabled={reset.isPending}>取消</Button>
        <Button type="submit" variant="danger" busy={reset.isPending} busyLabel="重置中…">重置密码</Button>
      </div>
    </form>
  );
}

export function ResetPasswordDialog({ open, onOpenChange, userId, username }: Props) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={`重置 ${username} 的密码`}
      description="重置后，该用户的全部会话会失效，需要用新密码重新登录。">
      <ResetPasswordForm onOpenChange={onOpenChange} userId={userId} username={username} />
    </FormDialog>
  );
}
