// 合成样本：正文超过 BODY_INDEX_CAP_BYTES（32 KB）的邮件。体积太大，不放静态 .eml，由种子脚本与测试按需生成。
// 本文件会被 Node 直接加载（种子脚本），不要引入相对 import。

export const LARGE_MAIL_CODE = "246810";
export const LARGE_MAIL_TAIL_MARKER = "END-OF-LARGE-BODY";

const FILLER_LINE = "This is synthetic filler text used to push the body size past the index cap. ";
const FILLER_REPEAT = 600;

export function buildLargeMail(): string {
  const filler = Array.from({ length: FILLER_REPEAT }, (_, i) => `${FILLER_LINE}(${i})`).join("\n");
  return [
    "X-Synthetic-Sample: synthetic fixture, not a real email",
    "Return-Path: <bulk@mailer.example.org>",
    "From: Example Bulk <bulk@mailer.example.org>",
    "To: plain.user@example.com",
    "Subject: Large synthetic message",
    "Date: Fri, 20 Nov 2026 08:35:00 +0000",
    "Message-ID: <synthetic-large-0014@mailer.example.org>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    `Your verification code is ${LARGE_MAIL_CODE}.`,
    "",
    filler,
    "",
    LARGE_MAIL_TAIL_MARKER,
    "",
  ].join("\n");
}
