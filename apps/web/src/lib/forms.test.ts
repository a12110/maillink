import { describe, expect, it } from "vitest";
import { adminUserCreateSchema, setupRequestSchema } from "@maillink/shared";
import { fieldErrorsFromZod } from "./forms";

describe("fieldErrorsFromZod", () => {
  it("把 @maillink/shared 的校验消息按字段归位（每字段取第一条）", () => {
    const parsed = setupRequestSchema.safeParse({ username: "a", password: "short", setup_token: "" });
    if (parsed.success) throw new Error("应该校验失败");
    const { fields, form } = fieldErrorsFromZod(parsed.error, ["username", "password", "setup_token"]);
    expect(fields.username).toContain("至少 3");
    expect(fields.password).toContain("至少 10");
    expect(fields.setup_token).toBe("请输入初始化令牌");
    expect(form).toBeNull();
  });

  it("不在字段表里的问题落到 form 级", () => {
    const parsed = adminUserCreateSchema.safeParse({ username: "alice", password: "long-enough-pw", email: "nope" });
    if (parsed.success) throw new Error("应该校验失败");
    const { fields, form } = fieldErrorsFromZod(parsed.error, ["username", "password"]);
    expect(fields).toEqual({});
    expect(form).not.toBeNull();
  });
});
