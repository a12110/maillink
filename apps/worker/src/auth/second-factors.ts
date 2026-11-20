import { claimTotpStep, findTotpState, findUnusedRecoveryCode, useRecoveryCodeById } from "../db/totp";
import type { Bindings } from "../env";
import { createRecoveryCodeHasher, normalizeRecoveryCode } from "./recovery-codes";
import { decryptTotpSecret } from "./totp-service";
import { matchTotp } from "./totp";

// 登录第二步的因素校验，分两段：check 只读校验，不消耗任何东西；consume 才真正占用时间步 / 用掉恢复码。
// 调用方先抢占 pending_auth，再 consume，同一 pending_auth 并发提交两个正确因素时，输的一方什么都不消耗。

export type FactorCheck =
  | { result: "ok"; consume: () => Promise<boolean> }
  | { result: "invalid" | "replayed" | "not_enabled" };

export type SecondFactor = (userId: number) => Promise<FactorCheck>;

type FactorEnv = Pick<Bindings, "APP_SECRET" | "APP_DB">;

export function totpFactor(env: FactorEnv, code: string, now: number): SecondFactor {
  return async (userId) => {
    const state = await findTotpState(env.APP_DB, userId);
    if (!state?.totp_secret_enc) return { result: "not_enabled" };
    const step = await matchTotp(await decryptTotpSecret(env, userId, state.totp_secret_enc), code, now);
    if (step === null) return { result: "invalid" };
    if (state.totp_last_step !== null && step <= state.totp_last_step) return { result: "replayed" };
    return { result: "ok", consume: () => claimTotpStep(env.APP_DB, userId, step) };
  };
}

export function recoveryFactor(env: FactorEnv, code: string, now: number): SecondFactor {
  return async (userId) => {
    const normalized = normalizeRecoveryCode(code);
    if (normalized === null) return { result: "invalid" };
    const hash = await (await createRecoveryCodeHasher(env))(normalized);
    const id = await findUnusedRecoveryCode(env.APP_DB, userId, hash);
    if (id === null) return { result: "invalid" };
    return { result: "ok", consume: () => useRecoveryCodeById(env.APP_DB, id, now) };
  };
}
