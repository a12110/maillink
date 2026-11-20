import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { registerRequestSchema, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@maillink/shared";
import type { PublicConfig, RegisterRequest } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { publicConfigQuery, sessionQuery } from "../../api/queries";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { fieldErrorsFromZod } from "../../lib/forms";
import type { FieldErrors } from "../../lib/forms";
import { describeError } from "../../lib/messages";
import { Button, Callout, ErrorCallout, TextField } from "../../ui";
import { TurnstileWidget } from "../turnstile/TurnstileWidget";
import type { TurnstileLoader } from "../turnstile/loader";
import { describeRegisterError } from "./errors";

const FIELDS = ["username", "password", "email"] as const;
type Field = (typeof FIELDS)[number];

/** 该入口是否要渲染 Turnstile：系统启用且作用范围含 register */
export function registerNeedsTurnstile(config: PublicConfig): boolean {
  return config.turnstile.enabled && config.turnstile.scopes.includes("register");
}

function useRegister() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: RegisterRequest) => {
      await api.register(body);
      // 注册成功即已登录：以会话接口为准刷新缓存，再由 `/` 按角色分流
      await queryClient.fetchQuery({ ...sessionQuery(), staleTime: 0 });
    },
    onSuccess: () => navigate({ to: "/" }),
  });
}

function Closed() {
  return (
    <>
      <Callout title="未开放注册">管理员目前没有开放自助注册。如需账号，请联系管理员创建。</Callout>
      <Link to="/login" className="btn" data-variant="secondary" data-block="true">
        去登录
      </Link>
    </>
  );
}

type FormProps = { config: PublicConfig; loader?: TurnstileLoader };

/** 服务端按字段返回的错误，在对应输入框下就地显示 */
function serverFieldErrors(error: unknown): Partial<Record<Field, string>> {
  const pick = (code: string) => (isApiError(error, code) ? error.message : undefined);
  return { username: pick("username_taken"), email: pick("email_taken"), password: pick("password_too_short") };
}

/** Turnstile 区：作用范围含 register 才渲染；site key 没填时明确提示，不静默跳过 */
function TurnstileSlot({ config, loader, onToken, resetKey }: FormProps & { onToken: (token: string | null) => void; resetKey: number }) {
  if (!registerNeedsTurnstile(config)) return null;
  if (config.turnstile.site_key === "") {
    return <Callout tone="danger" title="人机验证配置不完整">管理员启用了注册人机验证，但没有填写 site key，暂时无法注册。</Callout>;
  }
  return <TurnstileWidget siteKey={config.turnstile.site_key} action="register" onToken={onToken} resetKey={resetKey} loader={loader} />;
}

function buildBody(values: Record<Field, string>, token: string | null): RegisterRequest {
  return {
    username: values.username,
    password: values.password,
    ...(values.email.trim() === "" ? {} : { email: values.email }),
    ...(token === null ? {} : { turnstile_token: token }),
  };
}

/**
 * 客户端校验：zod 管格式与硬下限；管理员调高的最小长度取公开配置 password_min_length，
 * 与服务端 assertPasswordPolicy 同口径（按字符串 length）。服务端照常再校验一次。
 */
function validate(body: RegisterRequest, minLength: number): FieldErrors<Field> {
  const parsed = registerRequestSchema.safeParse(body);
  const fields = parsed.success ? {} : fieldErrorsFromZod(parsed.error, FIELDS).fields;
  if (fields.password === undefined && body.password.length < minLength) return { ...fields, password: `密码至少 ${minLength} 个字符` };
  return fields;
}

function RegisterForm({ config, loader }: FormProps) {
  const register = useRegister();
  const [values, setValues] = useState<Record<Field, string>>({ username: "", password: "", email: "" });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const needsToken = registerNeedsTurnstile(config);
  const blocked = needsToken && (config.turnstile.site_key === "" || token === null);
  const serverErrors = serverFieldErrors(register.error);

  const bind = (name: Field) => ({
    name,
    value: values[name],
    error: errors[name] ?? serverErrors[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = buildBody(values, needsToken ? token : null);
    const fieldErrors = validate(body, config.password_min_length);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    // token 一次性：无论成败都让控件重新出题
    register.mutate(body, { onError: () => { setToken(null); setResetKey((key) => key + 1); } });
  };

  // 提交时才发现注册已被关闭（后端 404）：换成未开放状态
  if (isApiError(register.error, "not_found")) return <Closed />;
  const fieldLevel = Object.values(serverErrors).some(Boolean);
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <TextField label="用户名" autoComplete="username" autoFocus
        hint={`${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符，字母或数字开头，可含 . _ -`} {...bind("username")} />
      <TextField label="密码" type="password" autoComplete="new-password"
        hint={`至少 ${config.password_min_length} 个字符`} {...bind("password")} />
      <TextField label="邮箱（可选）" type="email" autoComplete="email" hint="不会验证，也不会发送邮件" {...bind("email")} />
      <TurnstileSlot config={config} loader={loader} onToken={setToken} resetKey={resetKey} />
      {register.isError && !fieldLevel ? <ErrorCallout title="注册失败" {...describeRegisterError(register.error)} /> : null}
      <Button type="submit" variant="primary" block busy={register.isPending} busyLabel="注册中…" disabled={blocked}>注册</Button>
      <p className="auth-lead auth-alt">已有账号？<Link to="/login" className="text-action">去登录</Link></p>
    </form>
  );
}

export function RegisterPage({ loader }: { loader?: TurnstileLoader } = {}) {
  useDocumentTitle("注册");
  const config = useQuery(publicConfigQuery());
  return (
    <>
      <h1>注册</h1>
      {config.isError ? (
        <ErrorCallout title="无法读取站点配置" {...describeError(config.error)} onRetry={() => void config.refetch()} />
      ) : !config.data ? (
        <span className="skeleton" aria-label="加载中" />
      ) : !config.data.registration_enabled ? (
        <Closed />
      ) : (
        <>
          <p className="auth-lead">创建账号后即可登录，管理员会为你分配可查看的邮箱。</p>
          <RegisterForm config={config.data} loader={loader} />
        </>
      )}
    </>
  );
}
