import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { APP_SECRET_MIN_LENGTH } from "../src/constants";
import { toHex } from "../src/auth/crypto";
import { KEY_PURPOSES, deriveKey } from "../src/auth/keys";

describe("deriveKey (HKDF)", () => {
  it("不同用途派生出不同的密钥", async () => {
    const pepper = await deriveKey(env, KEY_PURPOSES.passwordPepper);
    const publicId = await deriveKey(env, KEY_PURPOSES.sessionPublicId);
    expect(toHex(pepper)).not.toBe(toHex(publicId));
  });

  it("同一用途与同一 APP_SECRET 结果稳定，长度可指定", async () => {
    const a = await deriveKey(env, KEY_PURPOSES.passwordPepper);
    const b = await deriveKey(env, KEY_PURPOSES.passwordPepper);
    expect(toHex(a)).toBe(toHex(b));
    expect(a.byteLength).toBe(32);
    expect((await deriveKey(env, KEY_PURPOSES.passwordPepper, 16)).byteLength).toBe(16);
  });

  it("不同 APP_SECRET 派生出不同的密钥", async () => {
    const other = { APP_SECRET: "a-completely-different-secret-value-0123456789" };
    const a = await deriveKey(env, KEY_PURPOSES.passwordPepper);
    const b = await deriveKey(other, KEY_PURPOSES.passwordPepper);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it("APP_SECRET 缺失时显式报错", async () => {
    await expect(deriveKey({ APP_SECRET: undefined }, KEY_PURPOSES.passwordPepper)).rejects.toThrow(/APP_SECRET/);
  });

  it("拒绝 .dev.vars.example 里的占位值（即使长度够）", async () => {
    const placeholder = { APP_SECRET: "replace-with-output-of-openssl-rand-base64-48" };
    expect(placeholder.APP_SECRET.length).toBeGreaterThanOrEqual(APP_SECRET_MIN_LENGTH);
    await expect(deriveKey(placeholder, KEY_PURPOSES.passwordPepper)).rejects.toThrow(/占位值/);
  });

  it("APP_SECRET 过短时显式报错", async () => {
    const tooShort = { APP_SECRET: "x".repeat(APP_SECRET_MIN_LENGTH - 1) };
    await expect(deriveKey(tooShort, KEY_PURPOSES.passwordPepper)).rejects.toThrow(/APP_SECRET/);
    const exact = { APP_SECRET: "x".repeat(APP_SECRET_MIN_LENGTH) };
    await expect(deriveKey(exact, KEY_PURPOSES.passwordPepper)).resolves.toBeInstanceOf(Uint8Array);
  });
});
