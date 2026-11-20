/** 候选邮件：不含正文，字段取自 MAIL_DB.raw_mails（01 §3.2） */
export type MailCandidate = {
  id: number;
  message_id: string | null;
  /** 信封发件人 */
  source: string | null;
  /** 信封收件人（转发链最后一跳） */
  address: string;
  /** 邮件头里的真实收件人；MAIL_DB 没有该列时恒为 null */
  to_address: string | null;
  /** 收件人：to_address，空则 address，全小写 */
  recipient: string;
  /** 入库时间，Unix 秒（来自 created_at） */
  received_at: number;
};

/**
 * 携带 MAIL_DB 绑定的对象（通常就是 c.env）。mail-source 之外的代码只把 `x.MAIL_DB` 直接交给 mail-source 的函数，
 * 自己的类型用这个名字声明，不在别处写 MAIL_DB（test/mail-db-guard.test.ts 守卫）。
 */
export type MailDbBinding = { MAIL_DB: D1Database };

/** 取 raw 的单封结果。失败（两列都空、gzip 损坏）不抛异常，由调用方把这封标成解析失败 */
export type RawMailResult =
  | {
      ok: true;
      id: number;
      /** 邮件原文（已解 gzip） */
      raw: string;
      /** temp_email 写的 metadata JSON 原文；没有该列或为空时为 null */
      metadata: string | null;
    }
  | { ok: false; id: number; error: string };

export type AdminMailScope = "all" | "imported" | "unknown";

export type AdminMailFilters = {
  /** 信封收件人 */
  address?: string;
  /** 邮件头收件人 */
  toAddress?: string;
  /** 信封发件人，不区分大小写 */
  source?: string;
  /** Unix 秒，含边界 */
  since?: number;
  until?: number;
  scope: AdminMailScope;
  /** 已导入地址（mailboxes.address，域名小写）；scope 为 imported / unknown 时必须提供 */
  importedAddresses?: string[];
  /** 向旧翻页：id < beforeId，按 id 倒序 */
  beforeId?: number;
  /** 增量轮询：id > afterId，按 id 正序 */
  afterId?: number;
  limit: number;
};
