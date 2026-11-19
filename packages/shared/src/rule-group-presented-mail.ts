import { z } from "zod";

// 呈现后的邮件对象（04 PresentedMail）：已按规则组呈现配置裁剪，不含 raw，被隐藏的字段不出现。

export const presentedAttachmentSchema = z.strictObject({
  index: z.number().int().min(0),
  name: z.string(),
  size: z.number().int().min(0),
  downloadable: z.boolean(),
});

export const presentedMailSchema = z.strictObject({
  id: z.number().int(),
  received_at: z.number().int(),
  sender: z
    .strictObject({
      address: z.string().optional(),
      domain: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  recipient: z.string().optional(),
  subject: z.string().optional(),
  snippet: z.string().optional(),
  code: z.string().optional(),
  login_link: z.string().optional(),
  /** click 取码方式下尚未显示，此时不含 subject / snippet / code / login_link / attachments */
  locked: z.boolean().optional(),
  attachments: z.array(presentedAttachmentSchema).optional(),
  /** 仅详情：纯文本（已做链接处理与脱敏） */
  text: z.string().optional(),
  /** 仅详情、仅 full 视图：清洗后的完整 HTML 文档，已内含 CSP，直接放进 sandbox iframe 的 srcdoc */
  html: z.string().optional(),
});
export type PresentedMail = z.infer<typeof presentedMailSchema>;

/**
 * 邮件 HTML 的 CSP（02 §4.5 第 3 条），另加 base-uri / form-action 两条兜底
 * （default-src 不覆盖这两项；清洗已删掉 base 与 form，这里是第二道）。
 */
export function buildMailCsp(remoteImages: "block" | "allow"): string {
  const imgSrc = remoteImages === "allow" ? "data: https:" : "data:";
  return `default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; base-uri 'none'; form-action 'none'`;
}

/** CSP 的 `<meta>` 片段，必须位于文档 `<head>` 的最前面才生效 */
export function buildMailCspMetaTag(remoteImages: "block" | "allow"): string {
  return `<meta http-equiv="Content-Security-Policy" content="${buildMailCsp(remoteImages)}">`;
}

/**
 * 把清洗后的 HTML 片段包成完整的 srcdoc 文档：CSP meta 在我们自己的 `<head>` 最前面，
 * 邮件自带的 `<html>/<head>/<body>` 标签落在 body 里会被解析器忽略（属性合并），不影响 CSP 生效。
 * 清洗结果之后**不追加任何内容**：若末尾残留未完成的标签，浏览器在文件结尾会丢弃它；
 * 一旦后面再拼上 `</body></html>`，它就会被闭合成活的标签。
 */
export function wrapMailHtmlDocument(sanitizedHtml: string, remoteImages: "block" | "allow"): string {
  return `<!DOCTYPE html><html><head>${buildMailCspMetaTag(remoteImages)}</head><body>${sanitizedHtml}`;
}
