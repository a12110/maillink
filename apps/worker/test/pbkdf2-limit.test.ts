import { describe, expect, it } from "vitest";
import { PBKDF2_ITERATIONS } from "../src/constants";

// PBKDF2 迭代数上限实测。
//
// 结论（写在 constants.ts 的 PBKDF2_ITERATIONS 注释里）：
// - Cloudflare Workers 生产环境上限为 100,000，超过抛 NotSupportedError
//   （Cloudflare 社区 2023-02、2025-10、2026-10 的多个帖子与 workerd#1346 一致）。
// - 本地 workerd（vitest / wrangler dev）不执行该上限：下面的 +1 用例在本地会成功。
//   所以这里的测试只能证明"取值在本地可运行"和"若运行时拒绝，必须是 NotSupportedError"，
//   无法在本地证明生产环境接受。部署后第一次登录必须作为冒烟检查。

const KNOWN_PRODUCTION_LIMIT = 100_000;
const KEY_BITS = 256;

async function derive(iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("pw"), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(16), iterations },
    key,
    KEY_BITS,
  );
}

describe("PBKDF2 迭代数上限", () => {
  it("采用的迭代数等于已知的生产上限", () => {
    expect(PBKDF2_ITERATIONS).toBe(KNOWN_PRODUCTION_LIMIT);
  });

  it("上限值本身可以运行", async () => {
    const bits = await derive(KNOWN_PRODUCTION_LIMIT);
    expect(bits.byteLength).toBe(KEY_BITS / 8);
  });

  it("上限 + 1：运行时若拒绝必须是 NotSupportedError；本地 workerd 不拒绝（见文件头说明）", async () => {
    const outcome = await derive(KNOWN_PRODUCTION_LIMIT + 1).then(
      () => "accepted" as const,
      (error: unknown) => error,
    );
    console.info(
      `PBKDF2 ${KNOWN_PRODUCTION_LIMIT + 1} 次在当前运行时:`,
      outcome === "accepted" ? "被接受（本地 workerd 不限制）" : String(outcome),
    );
    if (outcome !== "accepted") {
      expect((outcome as Error).name).toBe("NotSupportedError");
    }
  });
});
