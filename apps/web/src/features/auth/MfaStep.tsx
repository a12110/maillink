import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { mfaRecoveryRequestSchema, mfaTotpRequestSchema } from "@maillink/shared";
import type { MfaMethod } from "@maillink/shared";
import { api } from "../../api/instance";
import { Button, TextField } from "../../ui";
import { classifyMfaError, mfaEndpoint } from "./login-flow";
import type { MfaFailure } from "./login-flow";

type Props = {
  method: MfaMethod;
  onMethodChange: (method: MfaMethod) => void;
  onBack: () => void;
  /** 第二步通过，会话已发出 */
  onSuccess: () => Promise<void>;
  onFailure: (failure: MfaFailure) => void;
};

const COPY: Record<MfaMethod, { label: string; hint: string; switchLabel: string; other: MfaMethod }> = {
  totp: { label: "验证码", hint: "打开验证器应用，输入当前显示的 6 位数字", switchLabel: "改用恢复码", other: "recovery" },
  recovery: { label: "恢复码", hint: "输入一个还没用过的恢复码，如 ABCDE-FGHJK。每个恢复码只能用一次", switchLabel: "改用验证器验证码", other: "totp" },
};

export function MfaStep({ method, onMethodChange, onBack, onSuccess, onFailure }: Props) {
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const copy = COPY[method];
  const verify = useMutation({
    mutationFn: async (value: string) => {
      await api[mfaEndpoint(method)](value);
      await onSuccess();
    },
    onError: (error) => {
      setCode("");
      onFailure(classifyMfaError(error));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const schema = method === "totp" ? mfaTotpRequestSchema : mfaRecoveryRequestSchema;
    const parsed = schema.safeParse({ code });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    verify.mutate(parsed.data.code);
  };

  const switchMethod = () => {
    setCode("");
    setFieldError(undefined);
    onMethodChange(copy.other);
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <TextField
        key={method}
        label={copy.label}
        name="code"
        value={code}
        error={fieldError}
        hint={copy.hint}
        autoFocus
        mono
        autoComplete={method === "totp" ? "one-time-code" : "off"}
        inputMode={method === "totp" ? "numeric" : "text"}
        maxLength={method === "totp" ? 6 : undefined}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setCode(event.target.value)}
      />
      <Button type="submit" variant="primary" block busy={verify.isPending} busyLabel="验证中…">
        验证并登录
      </Button>
      <div className="auth-links">
        <button type="button" className="text-action" onClick={switchMethod}>{copy.switchLabel}</button>
        <button type="button" className="text-action" onClick={onBack}>返回，重新输入密码</button>
      </div>
    </form>
  );
}
