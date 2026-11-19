import { describe, expect, it } from "vitest";

// 只读守卫：src/mail-source/ 下任何源码出现写入 / 改结构的 SQL 关键字即失败。
// 01 §2：D1 没有只读 binding，只读靠代码保证。
// 用 Vite 的 glob 在构建期把源码当字符串读进来（workerd 里没有真实文件系统）。
const sources = import.meta.glob("../src/mail-source/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i;

/** 扫描前去掉注释，避免注释里的说明文字误报；字符串里的 SQL 必须保留 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("mail-source 只读守卫", () => {
  it("确实扫描到了 mail-source 下的源码文件", () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith("schema-probe.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("time.ts"))).toBe(true);
  });

  it("没有任何 INSERT/UPDATE/DELETE/ALTER/DROP/CREATE", () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) => {
      const match = FORBIDDEN.exec(stripComments(source));
      return match ? [`${file}: ${match[0]}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("守卫本身有效：能识别违规 SQL", () => {
    expect(FORBIDDEN.test("db.prepare('delete from raw_mails')")).toBe(true);
    expect(FORBIDDEN.test("INSERT INTO x")).toBe(true);
    expect(FORBIDDEN.test("SELECT id FROM raw_mails")).toBe(false);
  });
});
