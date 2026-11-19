import { ApiError, NetworkError, ResponseFormatError } from "../api/errors";

/** 面向用户的错误文案；总是带上错误码 / 状态，方便排查，不吞原因 */
const FRIENDLY_BY_CODE: Record<string, string> = {
  last_admin_protected:
    "这是最后一个启用的管理员，不能降级、停用或删除。请先把另一个用户设为启用的管理员，再操作这个账号。",
  username_taken: "用户名已被使用",
  email_taken: "邮箱已被其他用户使用",
  invalid_current_password: "当前密码错误",
  invalid_setup_token: "初始化令牌错误",
  cannot_revoke_current_session: "不能注销当前会话，请使用“退出登录”",
};

export function describeError(error: unknown): { message: string; detail: string } {
  if (error instanceof ApiError) {
    const message = FRIENDLY_BY_CODE[error.code] ?? error.message;
    return { message, detail: `${error.code} · HTTP ${error.status}` };
  }
  if (error instanceof NetworkError) {
    return { message: "无法连接服务器，请检查网络后重试。", detail: "network_error" };
  }
  if (error instanceof ResponseFormatError) {
    return { message: "服务器返回的数据格式与约定不符，请联系管理员。", detail: error.message };
  }
  if (error instanceof Error) return { message: error.message, detail: error.name };
  return { message: String(error), detail: "unknown" };
}

/** 单行文案：`原因（错误码）` */
export function errorLine(error: unknown): string {
  const { message, detail } = describeError(error);
  return `${message}（${detail}）`;
}
