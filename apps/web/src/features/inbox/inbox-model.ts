import type { MyMailbox, MyMailListItem, PresentedMail, ViewMode } from "@maillink/shared";
import { formatSender, isHttpUrl } from "../mail";

/** 邮箱切换的选择：`all` 或某个收件地址 id（`mailbox_id` 参数） */
export type InboxScope = { kind: "all" } | { kind: "mailbox"; mailbox: MyMailbox } | { kind: "missing"; mailboxId: number };

export function resolveScope(mailboxes: readonly MyMailbox[], mailboxId: number | undefined): InboxScope {
  if (mailboxId === undefined) return { kind: "all" };
  const mailbox = mailboxes.find((candidate) => candidate.mailbox_id === mailboxId);
  return mailbox ? { kind: "mailbox", mailbox } : { kind: "missing", mailboxId };
}

/** 能不能列邮件：规则组配置失效（available=false）或授权已不存在时不请求 */
export function scopeUnavailableReason(scope: InboxScope, mailboxes: readonly MyMailbox[]): string | null {
  if (scope.kind === "missing") return "这个邮箱已不在你的授权里（可能已过期或被收回）。";
  if (scope.kind === "mailbox" && !scope.mailbox.available) return "这个邮箱暂时不可用，请联系管理员。";
  if (scope.kind === "all" && !mailboxes.some((mailbox) => mailbox.available)) return "你的邮箱暂时都不可用，请联系管理员。";
  return null;
}

/** 邮箱在下拉里的显示名：地址隐藏时只说明“地址已隐藏”，不可用时灰显并提示（序号区分同类多项） */
export type MailboxOption = { value: string; label: string; disabled: boolean };

export function buildOptions(mailboxes: readonly MyMailbox[]): MailboxOption[] {
  let anonymous = 0;
  const options = mailboxes.map((mailbox): MailboxOption => {
    const value = String(mailbox.mailbox_id);
    if (!mailbox.available) {
      anonymous += 1;
      return { value, label: `邮箱 ${anonymous}（暂不可用，请联系管理员）`, disabled: true };
    }
    if (mailbox.address === null) {
      anonymous += 1;
      return { value, label: `地址已隐藏（${anonymous}）`, disabled: false };
    }
    const name = mailbox.label && mailbox.label !== mailbox.address ? `${mailbox.label} · ` : "";
    return { value, label: `${name}${mailbox.address}`, disabled: false };
  });
  return [{ value: "all", label: `全部邮箱（${mailboxes.filter((m) => m.available).length}）`, disabled: false }, ...options];
}

/** 视图是否有详情：code_only / meta_only 没有（后端详情接口对它们返回 404） */
export function viewHasDetail(view: ViewMode | null): boolean {
  return view === "full" || view === "text";
}

/**
 * 验证码卡片：条目所属授权的视图是 code_only（列表项自带 view，“全部”里各封各按自己的授权）。
 * 点击取码方式下尚未显示的条目（locked）没有验证码，按普通只读行显示。
 */
export function isCodeItem(mail: MyMailListItem): boolean {
  return mail.view === "code_only" && mail.locked !== true;
}

/** 这封邮件能不能打开详情：只看条目自带的 view（full / text 才有详情），locked 的不行 */
export function canOpenDetail(mail: MyMailListItem): boolean {
  return mail.locked !== true && viewHasDetail(mail.view);
}

/** 邮件详情接口的 `mailbox_id`：单个邮箱时带上，“全部”不带（后端按邮件自己的收件地址定位授权） */
export function detailMailboxId(scope: InboxScope): number | undefined {
  return scope.kind === "mailbox" ? scope.mailbox.mailbox_id : undefined;
}

/** 呈现后的发件人：名称与地址都有时 `名称 <地址>`；否则名称、地址、域名依次回退；全被隐藏返回 null */
export function presentedSender(sender: PresentedMail["sender"]): string | null {
  if (!sender) return null;
  return formatSender({ address: sender.address ?? null, name: sender.name ?? null }) ?? sender.domain ?? null;
}

/** 登录链接只显示它会打开的域名（完整地址含一次性令牌）；不是 http(s) 或解析失败返回 null，调用方不渲染成链接 */
export function loginLinkHost(link: string): string | null {
  if (!isHttpUrl(link)) return null;
  try {
    return new URL(link).host;
  } catch {
    return null;
  }
}
