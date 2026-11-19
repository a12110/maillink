import { describe, expect, it } from "vitest";
import { attachmentDisposition } from "../src/routes/content-disposition";

describe("attachmentDisposition", () => {
  it("ASCII 文件名：兜底与 filename* 都带上", () => {
    expect(attachmentDisposition("report.pdf", "attachment-0")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it("非 ASCII：兜底名里替换成下划线，filename* 用 UTF-8 百分号编码", () => {
    expect(attachmentDisposition("报告 final.txt", "x")).toBe(
      `attachment; filename="__ final.txt"; filename*=UTF-8''%E6%8A%A5%E5%91%8A%20final.txt`,
    );
  });

  it("引号、反斜杠、百分号、分号、CR/LF 不会出现在兜底名里，也不会让头部断行", () => {
    const value = attachmentDisposition('a"b\\c%d;e\r\nX-Evil: 1', "x");
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.split('"')).toHaveLength(3);
    expect(value).toContain("filename=\"a_b_c_d_e__X-Evil: 1\"");
    expect(value).toContain("%0D%0A");
  });

  it("RFC 5987 不允许的 ' ( ) * 被转义", () => {
    expect(attachmentDisposition("it's (1)*.txt", "x")).toContain("filename*=UTF-8''it%27s%20%281%29%2A.txt");
  });

  it("emoji 文件名：按码点截断，不切开代理对，不抛 URIError", () => {
    const name = "😀".repeat(300);
    const value = attachmentDisposition(name, "x");
    const encoded = /filename\*=UTF-8''(.+)$/.exec(value)?.[1] ?? "";
    expect(decodeURIComponent(encoded)).toBe("😀".repeat(200));
    // 恰好在代理对中间会被切开的长度：199 个 ASCII + 1 个 emoji
    expect(() => attachmentDisposition(`${"a".repeat(199)}😀😀`, "x")).not.toThrow();
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(attachmentDisposition(`${"a".repeat(199)}😀😀`, "x"))?.[1] ?? "")).toBe(`${"a".repeat(199)}😀`);
  });

  it("孤立的代理项（半个 emoji）被替换，不抛 URIError", () => {
    expect(() => attachmentDisposition("a\uD83Db.txt", "x")).not.toThrow();
    expect(attachmentDisposition("a\uD83Db.txt", "x")).toContain("a%EF%BF%BDb.txt");
  });

  it("路径分隔符在 ASCII 兜底名里换成下划线", () => {
    expect(attachmentDisposition("../etc/passwd", "x")).toContain('filename=".._etc_passwd"');
  });

  it("空文件名用兜底名；过长的文件名被截断", () => {
    expect(attachmentDisposition("  ", "attachment-2")).toContain('filename="attachment-2"');
    expect(attachmentDisposition("a".repeat(500), "x").length).toBeLessThan(500);
  });
});
