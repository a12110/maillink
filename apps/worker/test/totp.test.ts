import { describe, expect, it } from "vitest";
import { utf8 } from "../src/auth/crypto";
import { normalizeRecoveryCode, generateRecoveryCodes } from "../src/auth/recovery-codes";
import { FlowTokenError, decryptToken, encryptToken, signToken, verifySignedToken } from "../src/auth/signed-token";
import { base32Decode, base32Encode, hotp, matchTotp, otpauthUri, totpAt, totpStep } from "../src/auth/totp";
import { env } from "cloudflare:workers";
import { z } from "zod";

// RFC 6238 附录 B 的 SHA-1 测试向量（8 位码取后 6 位即 6 位码）
const RFC_SECRET = utf8("12345678901234567890");
const RFC_VECTORS: Array<[number, string]> = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("TOTP 纯函数", () => {
  it("RFC 6238 测试向量", async () => {
    for (const [time, code] of RFC_VECTORS) expect(await totpAt(RFC_SECRET, time), String(time)).toBe(code);
  });

  it("RFC 4226 HOTP 测试向量", async () => {
    expect(await hotp(RFC_SECRET, 0)).toBe("755224");
    expect(await hotp(RFC_SECRET, 9)).toBe("520489");
  });

  it("base32 往返，兼容小写与空格，拒绝非法字符", () => {
    expect(base32Encode(utf8("foobar"))).toBe("MZXW6YTBOI");
    expect(Array.from(base32Decode("mzxw 6ytb oi=="))).toEqual(Array.from(utf8("foobar")));
    const random = crypto.getRandomValues(new Uint8Array(20));
    expect(Array.from(base32Decode(base32Encode(random)))).toEqual(Array.from(random));
    expect(() => base32Decode("MZXW1")).toThrow();
  });

  it("前后各容忍一个时间步，再远拒绝；返回匹配的时间步", async () => {
    const time = 1_700_000_000;
    const step = totpStep(time);
    expect(await matchTotp(RFC_SECRET, await hotp(RFC_SECRET, step), time)).toBe(step);
    expect(await matchTotp(RFC_SECRET, await hotp(RFC_SECRET, step - 1), time)).toBe(step - 1);
    expect(await matchTotp(RFC_SECRET, await hotp(RFC_SECRET, step + 1), time)).toBe(step + 1);
    expect(await matchTotp(RFC_SECRET, await hotp(RFC_SECRET, step - 2), time)).toBeNull();
    expect(await matchTotp(RFC_SECRET, await hotp(RFC_SECRET, step + 2), time)).toBeNull();
    expect(await matchTotp(RFC_SECRET, "12345", time)).toBeNull();
    expect(await matchTotp(RFC_SECRET, "abcdef", time)).toBeNull();
  });

  it("otpauth URI 带齐参数并转义标签", () => {
    const uri = otpauthUri("Mail Link", "a@b", "ABC");
    expect(uri).toBe("otpauth://totp/Mail%20Link:a%40b?secret=ABC&issuer=Mail+Link&algorithm=SHA1&digits=6&period=30");
  });
});

describe("恢复码", () => {
  it("生成 10 个互不相同、格式 xxxxx-xxxxx 的码；规范化容忍小写、空格与连字符", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    const first = codes[0] ?? "";
    expect(normalizeRecoveryCode(` ${first.toLowerCase()} `)).toBe(first.replace("-", ""));
    expect(normalizeRecoveryCode("short")).toBeNull();
    expect(normalizeRecoveryCode("IIIII-IIIII")).toBeNull();
  });
});

describe("签名与加密令牌", () => {
  const schema = z.object({ typ: z.string(), exp: z.number(), jti: z.string(), v: z.number() });
  const payload = { typ: "t1", exp: 2_000_000_000, jti: "j", v: 1 };

  it("签名：篡改、错类型、过期都拒绝", async () => {
    const token = await signToken(env, payload);
    expect(await verifySignedToken(env, token, "t1", schema, 1_000)).toEqual(payload);
    const [body, sig] = token.split(".");
    const forged = `${btoa(JSON.stringify({ ...payload, v: 2 })).replace(/=+$/, "")}.${sig}`;
    await expect(verifySignedToken(env, forged, "t1", schema, 1_000)).rejects.toBeInstanceOf(FlowTokenError);
    await expect(verifySignedToken(env, token, "t2", schema, 1_000)).rejects.toThrow(/bad_signature/);
    await expect(verifySignedToken(env, token, "t1", schema, 2_000_000_000)).rejects.toThrow(/expired/);
    await expect(verifySignedToken(env, `${body}`, "t1", schema, 1_000)).rejects.toThrow(/malformed/);
  });

  it("加密：内容不可读，AAD 绑定类型", async () => {
    const token = await encryptToken(env, payload);
    expect(token).not.toContain("t1");
    expect(await decryptToken(env, token, "t1", schema, 1_000)).toEqual(payload);
    await expect(decryptToken(env, token, "t2", schema, 1_000)).rejects.toBeInstanceOf(FlowTokenError);
    await expect(decryptToken(env, `${token}x`, "t1", schema, 1_000)).rejects.toBeInstanceOf(FlowTokenError);
  });
});
