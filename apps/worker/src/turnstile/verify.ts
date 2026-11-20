import type { Context } from "hono";
import { z } from "zod";
import type { TurnstileScope } from "@maillink/shared";
import { clientIp } from "../auth/session";
import { TURNSTILE_FETCH_MAX_BYTES, TURNSTILE_FETCH_TIMEOUT_MS, TURNSTILE_VERIFY_URL } from "../constants";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_SERVICE_UNAVAILABLE } from "../http-status";
import { loadTurnstileConfig, openTurnstileSecret } from "./config";
import type { TurnstileConfig } from "./config";

// Cloudflare Turnstile 服务端校验（03 §5、PLAN"Turnstile 是取件页唯一外部资源例外"）。
// 失败关闭：需要校验但系统没配好 → 503 turnstile_not_configured，不放行；
// token 缺失或校验不通过 → 400 turnstile_failed；Cloudflare 校验服务不可达或响应异常 → 503 turnstile_unavailable。

const siteverifyResponseSchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});

function unavailable(reason: string): ApiError {
  console.error(`Turnstile 校验服务异常：${reason}`);
  return new ApiError(HTTP_SERVICE_UNAVAILABLE, "turnstile_unavailable", "人机验证服务暂时不可用，请稍后重试");
}

async function readCappedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (declared > TURNSTILE_FETCH_MAX_BYTES) throw unavailable("响应体超过上限");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > TURNSTILE_FETCH_MAX_BYTES) {
      await reader.cancel();
      throw unavailable("响应体超过上限");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function postSiteverify(secret: string, token: string, remoteIp: string | null): Promise<Response> {
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp !== null) form.set("remoteip", remoteIp);
  try {
    return await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(TURNSTILE_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw unavailable(`请求失败：${String(error)}`);
  }
}

/** 调 siteverify，返回 token 是否有效。传输层或响应格式问题抛 503 turnstile_unavailable */
export async function verifyTurnstileToken(secret: string, token: string, remoteIp: string | null): Promise<boolean> {
  const response = await postSiteverify(secret, token, remoteIp);
  if (!response.ok) throw unavailable(`HTTP ${response.status}`);
  let json: unknown;
  try {
    json = JSON.parse(await readCappedText(response));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable("响应不是 JSON");
  }
  const parsed = siteverifyResponseSchema.safeParse(json);
  if (!parsed.success) throw unavailable("响应格式不符");
  if (!parsed.data.success) console.warn("Turnstile 校验未通过", parsed.data["error-codes"] ?? []);
  return parsed.data.success;
}

export type EnforceTurnstileOptions = {
  /**
   * true = 调用方自己要求校验，与系统的作用范围无关（取件链接的 `access.turnstile`）。
   * 此时系统必须已启用 Turnstile、配好 site key 与 secret，且作用范围含该 scope，否则 503 turnstile_not_configured。
   */
  forced?: boolean;
};

type Requirement = "skip" | "not_configured" | "verify";

function requirementFor(config: TurnstileConfig, scope: TurnstileScope, forced: boolean): Requirement {
  const applies = config.enabled && config.scopes.includes(scope);
  if (!applies && !forced) return "skip";
  const ready = applies && config.siteKey !== "" && config.secretEnc !== "";
  return ready ? "verify" : "not_configured";
}

/**
 * 按系统设置对一次请求做人机验证。导出给各入口使用：
 *   登录 `enforceTurnstile(c, "login", body.turnstile_token)`、注册 `…"register"…`；
 *   取件页"开始取码"（M3b-2）：`await enforceTurnstile(c, "pickup", body.turnstile_token, { forced: link.access.turnstile })`。
 * 不需要校验时直接返回；需要时通过才返回，否则抛 ApiError（400 turnstile_failed / 503 turnstile_not_configured / 503 turnstile_unavailable）。
 */
export async function enforceTurnstile(
  c: Context<AppEnv>,
  scope: TurnstileScope,
  token: string | undefined,
  options: EnforceTurnstileOptions = {},
): Promise<void> {
  const config = await loadTurnstileConfig(c.env.APP_DB);
  const requirement = requirementFor(config, scope, options.forced === true);
  if (requirement === "skip") return;
  if (requirement === "not_configured") {
    throw new ApiError(HTTP_SERVICE_UNAVAILABLE, "turnstile_not_configured", "需要人机验证，但系统尚未配置 Turnstile");
  }
  if (token === undefined || token === "") {
    throw new ApiError(HTTP_BAD_REQUEST, "turnstile_failed", "请先完成人机验证");
  }
  const secret = await openTurnstileSecret(c.env, config.secretEnc);
  if (!(await verifyTurnstileToken(secret, token, clientIp(c)))) {
    throw new ApiError(HTTP_BAD_REQUEST, "turnstile_failed", "人机验证未通过，请重试");
  }
}
