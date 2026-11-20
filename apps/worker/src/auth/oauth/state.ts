import type { Context } from "hono";
import { z } from "zod";
import { nowSec } from "../../clock";
import { OAUTH_RANDOM_BYTES, OAUTH_STATE_SEC } from "../../constants";
import { consumeFlowToken } from "../../db/flow-tokens";
import type { AppEnv } from "../../env";
import { randomBytes, toBase64Url } from "../crypto";
import { FLOW_COOKIES, clearFlowCookie, readFlowCookie, setFlowCookie } from "../flow-cookies";
import { newJti } from "../mfa";
import { FlowTokenError, decryptToken, encryptToken } from "../signed-token";

// OAuth 流程状态：10 分钟有效的加密 Cookie oauth_flow（AES-GCM，AAD = cookie:oauth_flow）。
// 内容 { typ, jti, exp, pid: 提供方 id, slug, st: state, nn: nonce(仅 oidc), cv: PKCE code_verifier,
//        mode: login|link, uid: link 模式下发起的用户 id, sh: link 模式下发起时的会话 idHash }。
// 回调时无论成败都立即清除，jti 一次性消费；link 模式的回调要求当前会话与 uid、sh 都一致（auth/oauth-link.ts）。

const TYP = "oauth_flow";

const flowSchema = z.object({
  typ: z.literal(TYP),
  exp: z.number().int(),
  jti: z.string().min(1),
  pid: z.number().int().positive(),
  slug: z.string().min(1),
  st: z.string().min(1),
  nn: z.string().min(1).nullable(),
  cv: z.string().min(1),
  mode: z.enum(["login", "link"]),
  uid: z.number().int().positive().nullable(),
  sh: z.string().min(1).nullable(),
});
export type OAuthFlowState = z.infer<typeof flowSchema>;
export type OAuthMode = OAuthFlowState["mode"];

function randomToken(): string {
  return toBase64Url(randomBytes(OAUTH_RANDOM_BYTES));
}

export async function startFlowState(
  c: Context<AppEnv>,
  input: { providerId: number; slug: string; oidc: boolean; mode: OAuthMode; userId: number | null; sessionHash: string | null },
): Promise<OAuthFlowState> {
  const state: OAuthFlowState = {
    typ: TYP,
    exp: nowSec() + OAUTH_STATE_SEC,
    jti: newJti(),
    pid: input.providerId,
    slug: input.slug,
    st: randomToken(),
    nn: input.oidc ? randomToken() : null,
    cv: randomToken(),
    mode: input.mode,
    uid: input.userId,
    sh: input.sessionHash,
  };
  setFlowCookie(c, FLOW_COOKIES.oauthFlow, await encryptToken(c.env, state));
  return state;
}

/** 读取、清除并一次性消费流程状态；缺失、被篡改、过期、已用过都返回 null */
export async function takeFlowState(c: Context<AppEnv>): Promise<OAuthFlowState | null> {
  const token = readFlowCookie(c, FLOW_COOKIES.oauthFlow);
  clearFlowCookie(c, FLOW_COOKIES.oauthFlow);
  if (!token) return null;
  const now = nowSec();
  let state: OAuthFlowState;
  try {
    state = await decryptToken(c.env, token, TYP, flowSchema, now);
  } catch (error) {
    if (error instanceof FlowTokenError) return null;
    throw error;
  }
  return (await consumeFlowToken(c.env.APP_DB, state.jti, "oauth_flow", state.exp, now)) ? state : null;
}
