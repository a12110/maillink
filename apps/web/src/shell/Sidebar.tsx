import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import type { SessionUser } from "@maillink/shared";
import { displayNameOf, initialOf } from "../lib/format";
import { Button } from "../ui";
import { BrandMark, SiteName } from "./Brand";
import { navFor } from "./nav";

type SidebarContentProps = {
  user: SessionUser;
  loggingOut: boolean;
  onLogout: () => void;
  /** 点导航后回调（抽屉里用来关闭自己） */
  onNavigate?: () => void;
};

function NavGroups({ role, onNavigate }: { role: SessionUser["role"]; onNavigate?: () => void }) {
  return (
    <nav className="nav" aria-label="主导航">
      {navFor(role).map((group) => (
        <div className="nav-group" key={group.label ?? "main"}>
          {group.label ? <p className="nav-label">{group.label}</p> : null}
          {group.items.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="nav-item" onClick={onNavigate}>
              <Icon />
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

function UserBlock({ user, loggingOut, onLogout, onNavigate }: SidebarContentProps) {
  const name = displayNameOf(user);
  return (
    <div className="sidebar-foot">
      <div className="user-row">
        <Link to="/account" className="user-chip" onClick={onNavigate} title="账号安全">
          <span className="avatar" aria-hidden="true">
            {initialOf(name)}
          </span>
          <span className="user-chip-text">
            <span className="user-chip-name">{name}</span>
            <span className="user-chip-sub">{user.role === "admin" ? "管理员 · 账号安全" : "账号安全"}</span>
          </span>
        </Link>
        <Button variant="ghost" iconOnly aria-label="退出登录" title="退出登录" busy={loggingOut} onClick={onLogout}>
          <LogOut />
        </Button>
      </div>
    </div>
  );
}

/** 侧栏内容：桌面常驻、窄屏放进抽屉，两处共用 */
export function SidebarContent(props: SidebarContentProps) {
  return (
    <>
      <Link to="/" className="brand" onClick={props.onNavigate}>
        <BrandMark />
        <SiteName />
      </Link>
      <NavGroups role={props.user.role} onNavigate={props.onNavigate} />
      <UserBlock {...props} />
    </>
  );
}
