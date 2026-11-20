import type { Context } from "hono";
import { z } from "zod";
import { nowSec } from "../clock";
import { PASSKEY_CHALLENGE_SEC } from "../constants";
import { consumeFlowToken } from "../db/flow-tokens";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";
import { FLOW_COOKIES, clearFlowCookie, readFlowCookie, setFlowCookie } from "./flow-cookies";
import { newJti } from "./mfa";
import { FlowTokenError, signToken, verifySignedToken } from "./signed-token";

// 通行密钥 challenge 的签名 Cookie：{ typ, ch: challenge(base64url), uid?: 注册时的用户, jti, exp }。
// challenge 不落库；jti 在 auth_flow_tokens 里一次性消费，同一个 challenge 第二次提交即失败。

type ChallengeKind = "registration" | "login";

const KINDS = {
  registration: { typ: "passkey_reg", purpose: "passkey_reg", cookie: FLOW_COOKIES.passkeyRegistration },
  login: { typ: "passkey_auth", purpose: "passkey_auth", cookie: FLOW_COOKIES.passkeyLogin },
} as const;

const challengeSchema = z.object({
  typ: z.string(),
  exp: z.number().int(),
  jti: z.string().min(1),
  ch: z.string().min(1),
  uid: z.number().int().positive().optional(),
});

export type PasskeyChallenge = { challenge: string; userId?: number };

export function challengeInvalid(): ApiError {
  return new ApiError(HTTP_BAD_REQUEST, "passkey_challenge_invalid", "通行密钥请求已失效，请重试");
}

export async function issuePasskeyChallenge(
  c: Context<AppEnv>,
  kind: ChallengeKind,
  challenge: string,
  userId?: number,
): Promise<void> {
  const spec = KINDS[kind];
  const payload = { typ: spec.typ, exp: nowSec() + PASSKEY_CHALLENGE_SEC, jti: newJti(), ch: challenge, uid: userId };
  setFlowCookie(c, spec.cookie, await signToken(c.env, payload));
}

/** 读取并一次性消费 challenge（无论后续校验成败，这个 challenge 都不能再用）；Cookie 同时清除 */
export async function consumePasskeyChallenge(c: Context<AppEnv>, kind: ChallengeKind): Promise<PasskeyChallenge> {
  const spec = KINDS[kind];
  const token = readFlowCookie(c, spec.cookie);
  clearFlowCookie(c, spec.cookie);
  if (!token) throw challengeInvalid();
  const now = nowSec();
  let payload: z.infer<typeof challengeSchema>;
  try {
    payload = await verifySignedToken(c.env, token, spec.typ, challengeSchema, now);
  } catch (error) {
    if (error instanceof FlowTokenError) throw challengeInvalid();
    throw error;
  }
  if (!(await consumeFlowToken(c.env.APP_DB, payload.jti, spec.purpose, payload.exp, now))) throw challengeInvalid();
  return payload.uid === undefined ? { challenge: payload.ch } : { challenge: payload.ch, userId: payload.uid };
}
