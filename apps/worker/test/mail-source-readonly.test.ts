import { describe, expect, it } from "vitest";
import { findViolations } from "./sql-guard";

// 只读守卫：src/mail-source/ 下任何源码出现写入 / 改结构的 SQL 即失败。
// 扫描与去注释逻辑在 sql-guard.ts，自身的单测在 sql-guard.test.ts。
// 用 Vite 的 glob 在构建期把源码当字符串读进来（workerd 里没有真实文件系统）。
const sources = import.meta.glob("../src/mail-source/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("mail-source 只读守卫", () => {
  it("确实扫描到了 mail-source 下的源码文件", () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith("schema-probe.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("time.ts"))).toBe(true);
    // M2 新增的查询文件也在扫描范围内
    for (const name of ["candidates.ts", "raw.ts", "guard.ts", "gzip.ts", "addresses.ts"]) {
      expect(files.some((file) => file.endsWith(`/${name}`)), name).toBe(true);
    }
  });

  it("没有任何写入、改结构或改库设置的 SQL", () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) =>
      findViolations(source).map((violation) => `${file}: [${violation.rule}] ${violation.match}`),
    );
    expect(offenders).toEqual([]);
  });
});
