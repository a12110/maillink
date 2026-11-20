import { useEffect, useRef, useState } from "react";
import type { TurnstileScope } from "@maillink/shared";
import { Callout } from "../../ui";
import { loadTurnstile } from "./loader";
import type { TurnstileLoader } from "./loader";

type TurnstileWidgetProps = {
  siteKey: string;
  action: TurnstileScope;
  /** 通过验证给出 token；token 过期、超时或出错时给 null，表单应据此禁用提交 */
  onToken: (token: string | null) => void;
  /** 每次递增就重置控件：token 一次性，提交失败（无论什么原因）后都应重置 */
  resetKey?: number;
  loader?: TurnstileLoader;
};

type Problem = { kind: "script" | "widget"; message: string };

/**
 * Cloudflare Turnstile 控件（显式渲染）。挂载时才加载脚本；脚本加载失败或控件报错都显示出来并给“重试”，不静默放行。
 * 卸载时移除控件。
 */
export function TurnstileWidget({ siteKey, action, onToken, resetKey = 0, loader = loadTurnstile }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const apiRef = useRef<Awaited<ReturnType<TurnstileLoader>> | null>(null);
  const onTokenRef = useRef(onToken);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);
  onTokenRef.current = onToken;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let cancelled = false;
    setProblem(null);
    loader().then(
      (api) => {
        if (cancelled) return;
        apiRef.current = api;
        widgetId.current = api.render(container, {
          sitekey: siteKey,
          action,
          size: "flexible",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "timeout-callback": () => onTokenRef.current(null),
          "error-callback": (code) => {
            onTokenRef.current(null);
            setProblem({ kind: "widget", message: `人机验证出错（${code}）` });
          },
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        onTokenRef.current(null);
        setProblem({ kind: "script", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
      if (widgetId.current !== null) apiRef.current?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action, loader, attempt]);

  useEffect(() => {
    if (resetKey === 0 || widgetId.current === null) return;
    apiRef.current?.reset(widgetId.current);
    onTokenRef.current(null);
  }, [resetKey]);

  const retry = () => {
    if (problem?.kind === "widget" && widgetId.current !== null) {
      setProblem(null);
      apiRef.current?.reset(widgetId.current);
    } else {
      setAttempt((value) => value + 1);
    }
  };

  return (
    <div className="turnstile">
      <div ref={containerRef} className="turnstile-box" data-testid="turnstile-container" />
      {problem ? (
        <Callout
          tone="danger"
          title={problem.kind === "script" ? "无法加载人机验证组件" : "人机验证没有完成"}
          actions={<button type="button" className="text-action" onClick={retry}>重试</button>}
        >
          {problem.message}
        </Callout>
      ) : null}
    </div>
  );
}
