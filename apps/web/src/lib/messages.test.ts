import { describe, expect, it } from "vitest";
import { ApiError, NetworkError, ResponseFormatError } from "../api/errors";
import { describeError, errorLine } from "./messages";

describe("错误文案", () => {
  it("最后管理员保护：给出可操作的中文提示并带错误码", () => {
    const { message, detail } = describeError(new ApiError(409, "last_admin_protected", "server text"));
    expect(message).toContain("最后一个启用的管理员");
    expect(detail).toBe("last_admin_protected · HTTP 409");
  });

  it("未登记的错误码沿用服务端 message，仍带错误码", () => {
    expect(errorLine(new ApiError(500, "internal_error", "服务器内部错误"))).toBe(
      "服务器内部错误（internal_error · HTTP 500）",
    );
  });

  it("网络错误与契约错误分别说明", () => {
    expect(describeError(new NetworkError("/api/x", new TypeError("x"))).detail).toBe("network_error");
    expect(describeError(new ResponseFormatError("/api/x", "status: 无效")).message).toContain("格式");
  });
});
