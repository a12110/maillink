import { describe, expect, it } from "vitest";

// MAIL_DB 防误迁移：wrangler 在 D1 绑定没配 migrations_dir 时默认用 ./migrations（即 APP_DB 的迁移），
// 所以 wrangler.jsonc 把 MAIL_DB 的 migrations_dir 指向一个必须保持为空的目录。这里守住两点：
// 该目录里没有任何 .sql；wrangler.jsonc 里 MAIL_DB 确实指向它（APP_DB 仍指向 migrations）。
// workerd 里没有真实文件系统，用 Vite 的 glob 在构建期把文件读进来。

const GUARD_DIR = "mail-db-no-migrations";

const guardFiles = import.meta.glob("../mail-db-no-migrations/**/*", { query: "?raw", import: "default", eager: true });
const wranglerConfig = import.meta.glob("../wrangler.jsonc", { query: "?raw", import: "default", eager: true });

/** 去掉 JSONC 的 // 与块注释（跳过字符串里的内容，例如 "http://…"）以及尾随逗号 */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    const next = text[i + 1];
    if (char === '"') {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (char === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 2;
    } else {
      out += char;
      i += 1;
    }
  }
  return out.replace(/,(\s*[}\]])/gu, "$1");
}

/** 从开引号位置找到字符串结束后的下标（处理反斜杠转义） */
function endOfString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

type D1Binding = { binding: string; migrations_dir?: string };

function d1Bindings(): D1Binding[] {
  const [source] = Object.values(wranglerConfig);
  if (source === undefined) throw new Error("没有读到 wrangler.jsonc");
  const config = JSON.parse(stripJsonc(source)) as { d1_databases: D1Binding[] };
  return config.d1_databases;
}

describe("MAIL_DB 防误迁移", () => {
  it("JSONC 去注释不误伤字符串里的 //", () => {
    expect(JSON.parse(stripJsonc('{ // c\n "a": "http://x", /* b */ "b": [1,], }'))).toEqual({ a: "http://x", b: [1] });
  });

  it(`${GUARD_DIR}/ 只有 README，没有任何 .sql`, () => {
    const files = Object.keys(guardFiles);
    expect(files.some((file) => file.endsWith(`/${GUARD_DIR}/README.md`))).toBe(true);
    expect(files.filter((file) => file.toLowerCase().endsWith(".sql"))).toEqual([]);
  });

  it("wrangler.jsonc：MAIL_DB 的 migrations_dir 指向空目录，APP_DB 指向 migrations", () => {
    const bindings = d1Bindings();
    expect(bindings.find((entry) => entry.binding === "MAIL_DB")?.migrations_dir).toBe(GUARD_DIR);
    expect(bindings.find((entry) => entry.binding === "APP_DB")?.migrations_dir).toBe("migrations");
  });
});
