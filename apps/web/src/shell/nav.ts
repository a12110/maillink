import { Inbox, Link2, ListFilter, Mail, ScrollText, Settings, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavPath =
  | "/admin/mailboxes"
  | "/admin/links"
  | "/admin/rule-groups"
  | "/admin/mails"
  | "/admin/users"
  | "/admin/settings"
  | "/admin/audit"
  | "/inbox"
  | "/account";

export type NavItem = { to: NavPath; label: string; icon: LucideIcon };
export type NavGroup = { label: string | null; items: NavItem[] };

const ADMIN_NAV: NavGroup[] = [
  {
    label: "邮件",
    items: [
      { to: "/admin/mailboxes", label: "收件地址", icon: Mail },
      { to: "/admin/links", label: "取件链接", icon: Link2 },
      { to: "/admin/rule-groups", label: "规则组", icon: ListFilter },
      { to: "/admin/mails", label: "全部邮件", icon: Inbox },
    ],
  },
  {
    label: "管理",
    items: [
      { to: "/admin/users", label: "用户", icon: Users },
      { to: "/admin/settings", label: "系统设置", icon: Settings },
      { to: "/admin/audit", label: "审计日志", icon: ScrollText },
    ],
  },
];

/** 用户角色只有“我的邮件”“账号安全”两项（05 §2） */
const USER_NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { to: "/inbox", label: "我的邮件", icon: Inbox },
      { to: "/account", label: "账号安全", icon: ShieldCheck },
    ],
  },
];

export function navFor(role: "admin" | "user"): NavGroup[] {
  return role === "admin" ? ADMIN_NAV : USER_NAV;
}
