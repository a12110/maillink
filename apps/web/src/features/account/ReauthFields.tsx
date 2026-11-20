import { useState } from "react";
import { Segmented, TextField } from "../../ui";
import { buildReauthBody, REAUTH_MODE_LABEL } from "./reauth";
import { availableReauthModes } from "./reauth";
import type { ReauthBody, ReauthContext, ReauthMode, ReauthValues } from "./reauth";

export type ReauthController = {
  modes: ReauthMode[];
  mode: ReauthMode;
  setMode: (mode: ReauthMode) => void;
  values: ReauthValues;
  setValues: (values: ReauthValues) => void;
  error: string | undefined;
  /** 校验并取出请求体；失败时把错误文案显示在输入框下并返回 null */
  collect: () => ReauthBody | null;
  /** 服务端拒绝（reauth_failed 等）时由调用方塞进输入框下 */
  setServerError: (message: string | undefined) => void;
};

const EMPTY: ReauthValues = { password: "", code: "" };

export function useReauth(context: ReauthContext): ReauthController {
  const modes = availableReauthModes(context);
  const [mode, setModeState] = useState<ReauthMode>(modes[0] ?? "none");
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState<string | undefined>();
  return {
    modes,
    mode,
    setMode: (next) => {
      setModeState(next);
      setError(undefined);
    },
    values,
    setValues,
    error,
    collect: () => {
      const built = buildReauthBody(mode, values);
      setError(built.ok ? undefined : built.error);
      return built.ok ? built.body : null;
    },
    setServerError: setError,
  };
}

const NONE_HINT = "你的账号没有密码。只要这次登录是最近 10 分钟内完成的就可以直接继续；否则请退出后重新登录再来操作。";

/** 敏感操作的再确认输入：当前密码 / 验证码 / 无需输入（没有密码的账号） */
export function ReauthFields({ controller, idPrefix }: { controller: ReauthController; idPrefix: string }) {
  const { modes, mode, values, error } = controller;
  return (
    <div className="dialog-form">
      {modes.length > 1 ? (
        <Segmented
          legend="用什么确认是你本人"
          name={`${idPrefix}-reauth`}
          value={mode}
          options={modes.map((value) => ({ value, label: REAUTH_MODE_LABEL[value] }))}
          onChange={controller.setMode}
        />
      ) : null}
      {mode === "password" ? (
        <TextField label="当前密码" type="password" autoComplete="current-password" value={values.password} error={error}
          onChange={(event) => controller.setValues({ ...values, password: event.target.value })} />
      ) : null}
      {mode === "code" ? (
        <TextField label="验证码" mono inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={values.code} error={error}
          hint="验证器应用里当前的 6 位数字" onChange={(event) => controller.setValues({ ...values, code: event.target.value })} />
      ) : null}
      {mode === "none" ? <p className="field-hint">{NONE_HINT}</p> : null}
    </div>
  );
}
