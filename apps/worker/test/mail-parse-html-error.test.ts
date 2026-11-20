import { describe, expect, it, vi } from "vitest";
import { MailParseError, parseMail } from "../src/mail-parse";
import type * as HtmlTextModule from "../src/mail-parse/html-text";
import { buildMail } from "./access-helpers";
import { candidateOf } from "./mail-helpers";

// extractHtmlOrFail 只把 lol-html 的"Parser error:"转成解析失败；其他异常是代码缺陷，原样抛出，不能被持久化成 failed。
// 替换取文字函数：按 HTML 里的标记抛出不同异常。

vi.mock("../src/mail-parse/html-text", async (importOriginal) => {
  const original = await importOriginal<typeof HtmlTextModule>();
  return {
    ...original,
    extractHtml: async (html: string) => {
      if (html.includes("SIM-PARSER")) throw new TypeError("Parser error: simulated ambiguity");
      if (html.includes("SIM-TYPEBUG")) throw new TypeError("Cannot read properties of undefined (reading 'x')");
      if (html.includes("SIM-BUG")) throw new Error("simulated code bug");
      return await original.extractHtml(html);
    },
  };
});

const parse = (html: string) => parseMail({ candidate: candidateOf({ id: 1 }), raw: buildMail({ html }), metadata: null });

describe("HTML 取文字的异常分流", () => {
  it("lol-html 解析器放弃（TypeError: Parser error: …）→ MailParseError", async () => {
    await expect(parse("<p>SIM-PARSER</p>")).rejects.toBeInstanceOf(MailParseError);
  });

  it.each([
    ["其他 TypeError", "<p>SIM-TYPEBUG</p>", TypeError],
    ["普通 Error", "<p>SIM-BUG</p>", Error],
  ])("%s：原样抛出，不转成 MailParseError", async (_name, html, type) => {
    const error = await parse(html).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(type);
    expect(error).not.toBeInstanceOf(MailParseError);
  });
});
