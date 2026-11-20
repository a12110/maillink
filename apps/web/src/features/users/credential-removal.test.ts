import { describe, expect, it, vi } from "vitest";
import { describeRemoval, runRemoval } from "./credential-removal";
import type { RemovalApi } from "./credential-removal";

const RESULT = { status: "ok" as const, removed: 1, sessions_revoked: 2, no_login_method: false };

function fakeApi(): RemovalApi {
  return {
    clearUserTotp: vi.fn(async () => RESULT),
    clearUserPasskeys: vi.fn(async () => RESULT),
    clearUserIdentities: vi.fn(async () => RESULT),
  };
}

describe("runRemoval：单个 / 全部各走各的接口", () => {
  it("两步验证", async () => {
    const api = fakeApi();
    await runRemoval(api, 5, { kind: "totp" });
    expect(api.clearUserTotp).toHaveBeenCalledWith(5);
  });

  it("通行密钥：单把带 id，全部不带", async () => {
    const api = fakeApi();
    await runRemoval(api, 5, { kind: "passkey", id: 3 });
    await runRemoval(api, 5, { kind: "passkey" });
    expect(api.clearUserPasskeys).toHaveBeenNthCalledWith(1, 5, 3);
    expect(api.clearUserPasskeys).toHaveBeenNthCalledWith(2, 5, undefined);
  });

  it("OAuth 绑定：单个带 id，全部不带", async () => {
    const api = fakeApi();
    await runRemoval(api, 5, { kind: "identity", id: 8 });
    await runRemoval(api, 5, { kind: "identity" });
    expect(api.clearUserIdentities).toHaveBeenNthCalledWith(1, 5, 8);
    expect(api.clearUserIdentities).toHaveBeenNthCalledWith(2, 5, undefined);
  });
});

describe("describeRemoval：二次确认写明后果", () => {
  it("两步验证：说明删密钥与恢复码、会话失效", () => {
    const copy = describeRemoval({ kind: "totp" }, "bob", false);
    expect(copy.title).toContain("bob");
    expect(copy.consequence).toContain("恢复码");
    expect(copy.consequence).toContain("全部会话会随之失效");
  });

  it("单把 / 全部的标题不同", () => {
    expect(describeRemoval({ kind: "passkey", id: 1, name: "YubiKey" }, "bob", false).title).toContain("YubiKey");
    expect(describeRemoval({ kind: "passkey" }, "bob", false).title).toContain("全部通行密钥");
    expect(describeRemoval({ kind: "identity" }, "bob", false).confirmLabel).toBe("全部清除");
  });

  it("清自己的凭据：说明当前会话保留", () => {
    expect(describeRemoval({ kind: "identity", id: 1, name: "GitHub" }, "root", true).consequence).toContain("当前会话保留");
  });

  it("提醒管理员操作不检查剩余登录方式", () => {
    expect(describeRemoval({ kind: "totp" }, "bob", false).consequence).toContain("不会检查是否还剩其他登录方式");
  });
});
