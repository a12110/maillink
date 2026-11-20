import { describe, expect, it } from "vitest";
import { buildRecoveryCodesFile, IDLE_TOTP_FLOW, totpFlowReducer } from "./totp-flow";
import type { TotpFlow } from "./totp-flow";

const SETUP = { secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/MailLink:alice?secret=JBSWY3DPEHPK3PXP", expires_at: 2_000_000_000 };
const CODES = ["AAAAA-BBBBB", "CCCCC-DDDDD"];

describe("两步验证流程状态：setup → enable → 恢复码只显示一次", () => {
  it("正常路径：idle → setup → codes → idle，确认后恢复码不留在状态里", () => {
    const setup = totpFlowReducer(IDLE_TOTP_FLOW, { type: "setup_started", setup: SETUP });
    expect(setup).toEqual({ phase: "setup", secret: SETUP.secret, otpauthUri: SETUP.otpauth_uri, expiresAt: SETUP.expires_at });

    const codes = totpFlowReducer(setup, { type: "enabled", codes: CODES });
    expect(codes).toEqual({ phase: "codes", codes: CODES, origin: "enable" });

    const done = totpFlowReducer(codes, { type: "codes_acknowledged" });
    expect(done).toEqual(IDLE_TOTP_FLOW);
    expect(JSON.stringify(done)).not.toContain("AAAAA");
  });

  it("取消设置回到 idle，密钥随之丢弃", () => {
    const setup = totpFlowReducer(IDLE_TOTP_FLOW, { type: "setup_started", setup: SETUP });
    expect(totpFlowReducer(setup, { type: "setup_cancelled" })).toEqual(IDLE_TOTP_FLOW);
  });

  it("重新生成恢复码：idle → codes（origin=regenerate）", () => {
    expect(totpFlowReducer(IDLE_TOTP_FLOW, { type: "regenerated", codes: CODES })).toEqual({ phase: "codes", codes: CODES, origin: "regenerate" });
  });

  it("不合法的转移不改变状态：没有 setup 就不会出现“启用成功”的恢复码，展示恢复码期间不会被覆盖", () => {
    expect(totpFlowReducer(IDLE_TOTP_FLOW, { type: "enabled", codes: CODES })).toBe(IDLE_TOTP_FLOW);
    const showing: TotpFlow = { phase: "codes", codes: CODES, origin: "enable" };
    expect(totpFlowReducer(showing, { type: "regenerated", codes: ["X"] })).toBe(showing);
    expect(totpFlowReducer(showing, { type: "setup_started", setup: SETUP })).toBe(showing);
    expect(totpFlowReducer(IDLE_TOTP_FLOW, { type: "codes_acknowledged" })).toBe(IDLE_TOTP_FLOW);
  });
});

describe("恢复码下载文件", () => {
  it("包含站点名、账号、生成时间、每行一个恢复码", () => {
    const text = buildRecoveryCodesFile({ siteName: "MailLink", username: "alice", codes: CODES, now: new Date("2026-11-20T08:00:00Z") });
    expect(text).toContain("MailLink 恢复码");
    expect(text).toContain("账号：alice");
    expect(text).toContain("2026-11-20T08:00:00.000Z");
    expect(text.split("\n")).toEqual(expect.arrayContaining(CODES));
  });
});
