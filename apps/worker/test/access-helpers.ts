import { env } from "cloudflare:workers";
import type { RuleGroupConfigInput } from "@maillink/shared";
import { compilePolicy, type AccessScope } from "../src/access";
import { nowSec } from "../src/clock";
import { d1Time, insertMail } from "./mail-helpers";

// 流水线、收件地址、规则组测试的公共构造器（合成邮件，不是真实邮件）。

export type SimpleMail = {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  attachment?: { name: string; content: string };
};

let counter = 0;

/** 拼一封最简的 RFC 5322 邮件；有 html / attachment 时用 multipart/mixed */
export function buildMail(mail: SimpleMail): string {
  counter += 1;
  const headers = [
    "X-Synthetic-Sample: synthetic fixture, not a real email",
    `From: Sender <${mail.from ?? "noreply@login.example.org"}>`,
    `To: ${mail.to ?? "box@example.com"}`,
    `Subject: ${mail.subject ?? "Hello"}`,
    `Message-ID: <synthetic-access-${counter}@example.org>`,
    "MIME-Version: 1.0",
  ];
  const text = mail.text ?? "plain body";
  if (mail.html === undefined && mail.attachment === undefined) {
    return [...headers, "Content-Type: text/plain; charset=utf-8", "", text, ""].join("\r\n");
  }
  const boundary = `b-${counter}`;
  const parts = [`--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", text];
  if (mail.html !== undefined) parts.push(`--${boundary}`, "Content-Type: text/html; charset=utf-8", "", mail.html);
  if (mail.attachment !== undefined) {
    parts.push(
      `--${boundary}`,
      `Content-Type: text/plain; name="${mail.attachment.name}"`,
      `Content-Disposition: attachment; filename="${mail.attachment.name}"`,
      "",
      mail.attachment.content,
    );
  }
  parts.push(`--${boundary}--`, "");
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

/** 写一封邮件进 MAIL_DB；ageSec 为距现在的秒数 */
export async function putMail(mail: SimpleMail & { address?: string; ageSec?: number }): Promise<number> {
  const address = mail.address ?? mail.to ?? "box@example.com";
  return await insertMail({
    address,
    raw: buildMail({ ...mail, to: mail.to ?? address }),
    created_at: d1Time(nowSec() - (mail.ageSec ?? 0)),
  });
}

type ConfigOverrides = Partial<Omit<RuleGroupConfigInput, "present">> & { present?: Partial<RuleGroupConfigInput["present"]> };

export function baseConfig(overrides: ConfigOverrides = {}): RuleGroupConfigInput {
  return {
    schema_version: 1,
    time: overrides.time ?? { since: { type: "none" } },
    filter: overrides.filter ?? { mode: "blacklist", rules: [] },
    present: {
      view: "text",
      sender: "full",
      recipient: "full",
      snippet: true,
      links: "keep",
      remote_images: "block",
      attachments: "list",
      redact: [],
      extract: ["code"],
      ...overrides.present,
    },
    limits: overrides.limits ?? {},
  };
}

export function scopeOf(addresses: string[], config: RuleGroupConfigInput | null = baseConfig(), createdAt = 0): AccessScope {
  return {
    addresses,
    policy: config === null ? null : compilePolicy(config),
    anchors: { created_at: createdAt, first_access_at: null, anchor_reset_at: null },
  };
}

export async function mailIndexIds(): Promise<number[]> {
  const { results } = await env.APP_DB.prepare("SELECT mail_id FROM mail_index ORDER BY mail_id").all<{ mail_id: number }>();
  return results.map((row) => row.mail_id);
}
