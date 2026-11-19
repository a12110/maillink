import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { PASSWORD_MIN_LENGTH, setupRequestSchema, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { queryKeys } from "../../api/queries";
import { queryClient } from "../../app/query-client";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { fieldErrorsFromZod } from "../../lib/forms";
import type { FieldErrors } from "../../lib/forms";
import { describeError } from "../../lib/messages";
import { Button, Callout, ErrorCallout, TextField, useToast } from "../../ui";

const FIELDS = ["username", "password", "setup_token"] as const;
type Field = (typeof FIELDS)[number];

function useSetup() {
  const navigate = useNavigate();
  const toast = useToast();
  return useMutation({
    mutationFn: api.setup,
    onSuccess: async () => {
      queryClient.setQueryData(queryKeys.setupStatus, { needs_setup: false });
      toast.success("管理员已创建，请登录");
      await navigate({ to: "/login" });
    },
    onError: (error) => {
      // 已有用户后后端永久 404：把缓存纠正过来，页面给出去登录的入口
      if (isApiError(error, "not_found")) queryClient.setQueryData(queryKeys.setupStatus, { needs_setup: false });
    },
  });
}

function SetupError({ error }: { error: unknown }) {
  if (isApiError(error, "invalid_setup_token")) return null; // 显示在令牌字段下
  if (isApiError(error, "not_found")) {
    return (
      <Callout title="系统已经完成初始化">
        不需要再创建管理员。请<Link to="/login" className="text-action">前往登录</Link>。
      </Callout>
    );
  }
  return <ErrorCallout title="初始化失败" {...describeError(error)} />;
}

export function SetupPage() {
  useDocumentTitle("初始化");
  const setup = useSetup();
  const [values, setValues] = useState<Record<Field, string>>({ username: "", password: "", setup_token: "" });
  const [clientErrors, setClientErrors] = useState<FieldErrors<Field>>({});
  const tokenError = isApiError(setup.error, "invalid_setup_token") ? setup.error.message : undefined;

  const bind = (name: Field) => ({
    name,
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
    error: name === "setup_token" ? (clientErrors[name] ?? tokenError) : clientErrors[name],
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = setupRequestSchema.safeParse(values);
    if (!parsed.success) {
      setClientErrors(fieldErrorsFromZod(parsed.error, FIELDS).fields);
      return;
    }
    setClientErrors({});
    setup.mutate(parsed.data);
  };

  return (
    <>
      <h1>初始化系统</h1>
      <p className="auth-lead">创建第一个管理员账号。初始化令牌是部署时设置的 SETUP_TOKEN。</p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <TextField label="用户名" autoComplete="username" autoFocus
          hint={`${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符，字母或数字开头，可含 . _ -`} {...bind("username")} />
        <TextField label="密码" type="password" autoComplete="new-password"
          hint={`至少 ${PASSWORD_MIN_LENGTH} 个字符`} {...bind("password")} />
        <TextField label="初始化令牌" type="password" autoComplete="off" mono hint="SETUP_TOKEN" {...bind("setup_token")} />
        {setup.isError ? <SetupError error={setup.error} /> : null}
        <Button type="submit" variant="primary" block busy={setup.isPending} busyLabel="创建中…">
          创建管理员
        </Button>
      </form>
    </>
  );
}
