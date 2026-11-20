import { describe, expect, it } from "vitest";
import workerAuditSource from "../../../../worker/src/audit.ts?raw";
import { AUDIT_ACTION_LABEL, AUDIT_TARGET_LABEL, actionLabel } from "./labels";

// shared 没有导出审计动作集合：从 worker 源码里 AUDIT_ACTIONS 对象字面量解析出动作值（只读，不 import worker 运行时）
function workerActions(): string[] {
  const block = /export const AUDIT_ACTIONS = \{([\s\S]*?)\} as const;/u.exec(workerAuditSource)?.[1];
  if (!block) throw new Error("在 apps/worker/src/audit.ts 里找不到 AUDIT_ACTIONS 对象");
  return Array.from(block.matchAll(/^\s*\w+:\s*"([^"]+)",/gmu), (m) => m[1] as string);
}

describe("审计动作中文名", () => {
  it("worker 的每个审计动作都有中文名（防止新增动作漏配）", () => {
    const actions = workerActions();
    expect(actions.length).toBeGreaterThan(40);
    const missing = actions.filter((action) => actionLabel(action) === action);
    expect(missing).toEqual([]);
  });

  it("中文名表里没有 worker 已不存在的动作", () => {
    const actions = new Set(workerActions());
    expect(Object.keys(AUDIT_ACTION_LABEL).filter((key) => !actions.has(key))).toEqual([]);
  });

  it("新增的目标类型有中文名", () => {
    expect(AUDIT_TARGET_LABEL).toMatchObject({ share_link: "取件链接", grant: "邮箱授权", settings: "系统设置" });
  });
});
