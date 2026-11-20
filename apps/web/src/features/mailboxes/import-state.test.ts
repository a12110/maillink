import { describe, expect, it } from "vitest";
import { MAILBOX_LIMITS } from "@maillink/shared";
import type { AdminMailbox, MailboxImportItem, MailboxImportResponse } from "@maillink/shared";
import { checkImportInput, describeImportDrift, groupImportItems } from "./import-state";
import { deleteConsequence, summarizeBatch } from "./batch-state";
import { importReasonLabel } from "./labels";

const item = (line: number, status: MailboxImportItem["status"], reason: MailboxImportItem["reason"] = null): MailboxImportItem => ({
  line,
  tags: [],
  note: null,
  input: `a${line}@icloud.com`,
  address: status === "invalid" ? null : `a${line}@icloud.com`,
  status,
  reason,
  id: null,
});

describe("导入输入的本地检查", () => {
  it("空内容、只有空白：要求先粘贴", () => {
    expect(checkImportInput("")).toMatch(/粘贴/);
    expect(checkImportInput("  \n \n")).toMatch(/粘贴/);
  });

  it("超过一次最多的行数：写出行数与上限，空行不计", () => {
    const lines = Array.from({ length: MAILBOX_LIMITS.importMaxLines + 1 }, (_, i) => `a${i}@icloud.com`);
    expect(checkImportInput(lines.join("\n"))).toContain(`共 ${lines.length} 行`);
    expect(checkImportInput([...lines.slice(0, MAILBOX_LIMITS.importMaxLines), "", ""].join("\n"))).toBeNull();
  });

  it("超过字符上限", () => {
    expect(checkImportInput("a".repeat(MAILBOX_LIMITS.importMaxChars + 1))).toMatch(/字符/);
  });

  it("合法内容通过", () => {
    expect(checkImportInput("alias@icloud.com,平台 一;二,备注")).toBeNull();
  });
});

describe("导入预览", () => {
  it("按状态分组，保持原顺序", () => {
    const groups = groupImportItems([item(1, "new"), item(2, "invalid", "invalid_format"), item(3, "duplicate", "already_exists"), item(4, "new")]);
    expect(groups.new.map((i) => i.line)).toEqual([1, 4]);
    expect(groups.invalid.map((i) => i.line)).toEqual([2]);
    expect(groups.duplicate.map((i) => i.line)).toEqual([3]);
  });

  it("每种原因都有中文说明，无原因为空串", () => {
    expect(importReasonLabel(item(1, "duplicate", "already_exists"))).toBe("已经导入过");
    expect(importReasonLabel(item(2, "duplicate", "duplicate_in_input"))).toContain("本次导入内重复");
    expect(importReasonLabel(item(3, "invalid", "invalid_format"))).toContain("不是合法的邮箱地址");
    expect(importReasonLabel(item(4, "new"))).toBe("");
  });

  it("正式导入与预览不一致（被别处抢先导入）时给出差异说明，一致时为 null", () => {
    const response = (n: number): MailboxImportResponse => ({ dry_run: false, summary: { new: n, duplicate: 0, invalid: 0 }, items: [] });
    expect(describeImportDrift(response(5), response(5))).toBeNull();
    expect(describeImportDrift(response(5), response(3))).toContain("2 个地址在你确认前已被别处导入");
  });
});

describe("批量操作结果", () => {
  const mailbox = (id: number, address: string, link_count: number, grant_count: number): AdminMailbox => ({
    id, address, label: null, note: null, status: "active", tags: [], link_count, grant_count, last_received_at: null, created_at: 0, updated_at: 0,
  });
  const selected = new Map([
    [1, mailbox(1, "a@icloud.com", 2, 1)],
    [2, mailbox(2, "b@icloud.com", 0, 0)],
  ]);

  it("成功计数 + 失败逐条带地址与原因，不吞成总数", () => {
    const summary = summarizeBatch(
      [
        { id: 1, ok: true, error: null },
        { id: 2, ok: false, error: "too_many_tags" },
        { id: 9, ok: false, error: "not_found" },
      ],
      selected,
    );
    expect(summary.ok).toBe(1);
    expect(summary.failures).toEqual([
      { id: 2, address: "b@icloud.com", reason: expect.stringContaining("20 个") },
      { id: 9, address: "#9", reason: expect.stringContaining("不存在") },
    ]);
  });

  it("删除确认写出后果：数量、级联删除的链接与授权", () => {
    const text = deleteConsequence(selected);
    expect(text).toContain("2 个收件地址");
    expect(text).toContain("2 个取件链接和 1 个授权");
    expect(text).toContain("无法撤销");
  });
});
