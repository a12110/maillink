import { useEffect, useRef, useState } from "react";
import { loadTurnstile, TURNSTILE_ACTION } from "./turnstile-loader";

type PickupTurnstileProps = {
  siteKey: string;
  /** 验证通过给 token；过期 / 出错 / 超时给 null */
  onToken: (token: string | null) => void;
};

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

/**
 * 取件页"开始取码"一步的人机验证：显式渲染（占位 300×65），失败就地显示原因与"重试"，不降级成无验证。
 * 重新验证（如开始取码失败后 token 已作废）由父组件换 key 重挂载。
 */
export function PickupTurnstile({ siteKey, onToken }: PickupTurnstileProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    let api: Awaited<ReturnType<typeof loadTurnstile>> | null = null;
    setPhase({ kind: "loading" });
    loadTurnstile().then(
      (loaded) => {
        const mount = mountRef.current;
        if (cancelled || !mount) return;
        api = loaded;
        widgetId = loaded.render(mount, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          callback: (token) => onTokenRef.current(token),
          "error-callback": (code) => {
            onTokenRef.current(null);
            setPhase({ kind: "error", message: `人机验证出错${code ? `（${code}）` : ""}` });
          },
          "expired-callback": () => onTokenRef.current(null),
          "timeout-callback": () => onTokenRef.current(null),
        });
        setPhase({ kind: "ready" });
      },
      (error: unknown) => {
        if (!cancelled) setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
      onTokenRef.current(null);
      if (api && widgetId !== null) api.remove(widgetId);
    };
  }, [siteKey, attempt]);

  return (
    <div className="field">
      <span className="field-label" id="pk-turnstile-label">人机验证</span>
      <div className="pk-turnstile" role="group" aria-labelledby="pk-turnstile-label" data-phase={phase.kind}>
        <div ref={mountRef} className="pk-turnstile-mount" />
        {phase.kind === "loading" ? <span>正在加载人机验证…</span> : null}
        {phase.kind === "error" ? (
          <div className="pk-turnstile-error" role="alert">
            <b>{phase.message}</b>
            <button type="button" className="text-action hit" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          </div>
        ) : null}
      </div>
      <p className="field-hint">完成验证前，“开始取码”不可用。</p>
    </div>
  );
}
