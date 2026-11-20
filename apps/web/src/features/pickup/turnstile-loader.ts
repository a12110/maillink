// 取件页的最小 Turnstile 渲染。TODO（合并后）：改用 UI-4b 的 `TurnstileWidget`，删除本文件与 PickupTurnstile.tsx，
// 由主 agent 在合并时统一（要求不变：显式渲染、action 固定 `pickup`、按需加载脚本、加载失败明确报错）。
//
// 这是取件页"不加载第三方资源"的唯一例外：只有链接开启人机验证、且用户进入"开始取码"这一步时才会调用 loadTurnstile。

export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TURNSTILE_ACTION = "pickup";
const SCRIPT_MARK = "data-turnstile-loader";

export type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  "error-callback": (code?: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let pending: Promise<TurnstileApi> | null = null;

/** 加载脚本并返回 turnstile API；失败时抛出明确错误并允许下一次重新加载 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (pending) return pending;
  pending = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.setAttribute(SCRIPT_MARK, "true");
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("人机验证脚本已加载，但没有提供 turnstile 接口"));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("人机验证脚本加载失败（challenges.cloudflare.com 无法访问）"));
    };
    document.head.append(script);
  }).catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}
