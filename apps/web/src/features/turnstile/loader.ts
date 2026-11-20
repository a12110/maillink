import type { TurnstileScope } from "@maillink/shared";

// Turnstile 是取件页唯一允许的外部资源（DESIGN.md「不要做」、05 §4）：只在真正渲染控件时才插入脚本，显式渲染模式。
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type TurnstileRenderOptions = {
  sitekey: string;
  /** 只能是 login / register / pickup，服务端会校验与入口一致 */
  action: TurnstileScope;
  size: "flexible";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "error-callback": (errorCode: string) => void;
};

/** 控件脚本暴露的、本项目用到的那部分接口 */
export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

export type TurnstileLoader = () => Promise<TurnstileApi>;

/** 加载器用到的 script 元素与文档的最小形状（真实 document 满足它，测试里用替身） */
export type ScriptLike = {
  src: string;
  async: boolean;
  defer: boolean;
  onload: ((event: Event) => void) | null;
  onerror: ((event: Event | string) => void) | null;
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
};

export type ScriptDocument = {
  createScript: () => ScriptLike;
  append: (script: ScriptLike) => void;
};

export type LoaderEnv = {
  document: ScriptDocument;
  /** 读取脚本挂到 window 上的 turnstile 对象；还没有则返回 undefined */
  readGlobal: () => TurnstileApi | undefined;
};

const SCRIPT_MARK = "data-turnstile-loader";

/**
 * 创建脚本加载器：同一页面只插入一次脚本，并发调用共用同一个 Promise；
 * 加载失败时清掉脚本节点与缓存并抛错，调用方点“重试”会重新插入。
 */
export function createTurnstileLoader(env: LoaderEnv): TurnstileLoader {
  let pending: Promise<TurnstileApi> | null = null;

  const insert = (): Promise<TurnstileApi> =>
    new Promise((resolve, reject) => {
      const script = env.document.createScript();
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.setAttribute(SCRIPT_MARK, "true");
      const fail = (reason: string) => {
        script.remove();
        pending = null;
        reject(new Error(reason));
      };
      script.onload = () => {
        const api = env.readGlobal();
        if (api === undefined) fail("Turnstile 脚本已加载，但没有提供 turnstile 对象");
        else resolve(api);
      };
      script.onerror = () => fail("无法加载 Cloudflare Turnstile 脚本（网络被拦截或无法访问 challenges.cloudflare.com）");
      env.document.append(script);
    });

  return () => {
    const ready = env.readGlobal();
    if (ready !== undefined) return Promise.resolve(ready);
    pending ??= insert();
    return pending;
  };
}

const browserDocument: ScriptDocument = {
  createScript: () => document.createElement("script"),
  append: (script) => {
    if (!(script instanceof HTMLScriptElement)) throw new Error("Turnstile 加载器只能插入 script 元素");
    document.head.append(script);
  },
};

export const loadTurnstile: TurnstileLoader = createTurnstileLoader({
  document: browserDocument,
  readGlobal: () => (window as Window & { turnstile?: TurnstileApi }).turnstile,
});
