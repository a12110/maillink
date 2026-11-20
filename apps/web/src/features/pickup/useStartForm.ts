import { useState } from "react";
import type { FormEvent } from "react";
import type { LinkPublicStatus } from "@maillink/shared";
import { classifyPickupError, describeStartError } from "./failures";
import type { InlineProblem } from "./failures";
import type { PickupApi } from "./pickup-api";

type Options = {
  token: string;
  status: LinkPublicStatus;
  api: Pick<PickupApi, "start">;
  onStarted: (status: LinkPublicStatus) => void;
  onBlocked: () => void;
};

/** 这些错误不能就地解决（设备已满、每日上限、链接失效…），交给页面重新取状态 */
const BLOCKING_KINDS: ReadonlySet<string> = new Set(["device_limit", "daily_limit", "unavailable", "not_found", "not_yet_valid"]);

/** “开始取码”表单：口令、人机验证 token、提交与就地错误。Turnstile token 一次性，失败后换 epoch 重新验证 */
export function useStartForm({ token, status, api, onStarted, onBlocked }: Options) {
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<InlineProblem | null>(null);
  const needsTurnstile = status.turnstile.required;
  const passwordOk = !status.requires_password || password.trim() !== "";
  const ready = passwordOk && (!needsTurnstile || turnstileToken !== null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      onStarted(
        await api.start(token, {
          ...(status.requires_password ? { password } : {}),
          ...(needsTurnstile && turnstileToken !== null ? { turnstile_token: turnstileToken } : {}),
        }),
      );
    } catch (error) {
      if (BLOCKING_KINDS.has(classifyPickupError(error).kind)) {
        onBlocked();
        return;
      }
      setProblem(describeStartError(error));
      if (needsTurnstile) {
        setTurnstileToken(null);
        setEpoch((value) => value + 1);
      }
    } finally {
      setBusy(false);
    }
  };
  return { password, setPassword, setTurnstileToken, epoch, busy, problem, ready, submit };
}
