import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PBKDF2_ITERATIONS } from "../src/constants";
import { hashPassword, parsePasswordHash, verifyPassword } from "../src/auth/password";

const PASSWORD = "correct-horse-battery";
const FORMAT = /^pbkdf2-sha256\$(\d+)\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/;

describe("密码哈希", () => {
  it("存储格式为 pbkdf2-sha256$迭代数$盐$哈希，盐 16 字节、哈希 32 字节", async () => {
    const stored = await hashPassword(env, PASSWORD);
    const match = FORMAT.exec(stored);
    expect(match?.[1]).toBe(String(PBKDF2_ITERATIONS));
    const parsed = parsePasswordHash(stored);
    expect(parsed.salt.byteLength).toBe(16);
    expect(parsed.hash.byteLength).toBe(32);
  });

  it("同一密码每次的盐与哈希都不同", async () => {
    const [a, b] = await Promise.all([hashPassword(env, PASSWORD), hashPassword(env, PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it("正确密码通过，错误密码不通过", async () => {
    const stored = await hashPassword(env, PASSWORD);
    expect(await verifyPassword(env, PASSWORD, stored)).toBe(true);
    expect(await verifyPassword(env, `${PASSWORD}x`, stored)).toBe(false);
    expect(await verifyPassword(env, "", stored)).toBe(false);
  });

  it("哈希被篡改（改一位 / 换盐）不通过", async () => {
    const stored = await hashPassword(env, PASSWORD);
    const [algorithm, iterations, salt, hash] = stored.split("$") as [string, string, string, string];
    const flipped = `${hash.startsWith("A") ? "B" : "A"}${hash.slice(1)}`;
    expect(await verifyPassword(env, PASSWORD, [algorithm, iterations, salt, flipped].join("$"))).toBe(false);

    const otherSalt = (await hashPassword(env, PASSWORD)).split("$")[2] ?? "";
    expect(await verifyPassword(env, PASSWORD, [algorithm, iterations, otherSalt, hash].join("$"))).toBe(false);
  });

  it("迭代数被改动后不通过（说明校验确实按存储里的迭代数计算）", async () => {
    const stored = await hashPassword(env, PASSWORD);
    const tampered = stored.replace(`$${PBKDF2_ITERATIONS}$`, `$${PBKDF2_ITERATIONS - 1}$`);
    expect(await verifyPassword(env, PASSWORD, tampered)).toBe(false);
  });

  it("旧迭代数生成的哈希仍可校验（便于以后升级迭代数）", async () => {
    const legacy = await hashPassword(env, PASSWORD, 1000);
    expect(legacy.split("$")[1]).toBe("1000");
    expect(await verifyPassword(env, PASSWORD, legacy)).toBe(true);
    expect(await verifyPassword(env, "wrong", legacy)).toBe(false);
  });

  it("pepper 参与计算：换 APP_SECRET 后同一份哈希无法通过", async () => {
    const stored = await hashPassword(env, PASSWORD);
    const otherEnv = { APP_SECRET: "another-secret-value-that-is-long-enough-0123" };
    expect(await verifyPassword(otherEnv, PASSWORD, stored)).toBe(false);
  });

  it("盐或哈希字节长度不对（如被截断）：抛数据损坏错误，不当作密码错误", async () => {
    const stored = await hashPassword(env, PASSWORD);
    const [algorithm, iterations, salt, hash] = stored.split("$") as [string, string, string, string];
    const truncatedHash = [algorithm, iterations, salt, hash.slice(0, 20)].join("$");
    await expect(verifyPassword(env, PASSWORD, truncatedHash)).rejects.toThrow(/数据损坏/);
    const truncatedSalt = [algorithm, iterations, salt.slice(0, 8), hash].join("$");
    await expect(verifyPassword(env, PASSWORD, truncatedSalt)).rejects.toThrow(/数据损坏/);
    await expect(verifyPassword(env, PASSWORD, "pbkdf2-sha256$1000$$")).rejects.toThrow(/数据损坏/);
    expect(() => parsePasswordHash(`${algorithm}$${iterations}$${salt}$${hash}`)).not.toThrow();
  });

  it("格式损坏属于数据错误：抛异常，不当作密码错误", async () => {
    await expect(verifyPassword(env, PASSWORD, "plaintext")).rejects.toThrow(/格式/);
    await expect(verifyPassword(env, PASSWORD, "bcrypt$10$abc$def")).rejects.toThrow(/格式/);
    await expect(verifyPassword(env, PASSWORD, "pbkdf2-sha256$abc$AAAA$AAAA")).rejects.toThrow(/迭代数/);
    await expect(verifyPassword(env, PASSWORD, "pbkdf2-sha256$1000$***$AAAA")).rejects.toThrow(/base64/);
  });
});
