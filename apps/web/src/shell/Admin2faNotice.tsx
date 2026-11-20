import { Link } from "@tanstack/react-router";
import { Callout } from "../ui";
import { PageHeader } from "./PageHeader";

const TOTP_SECTION_HASH = "totp-title";

function GoEnable() {
  return <Link to="/account" hash={TOTP_SECTION_HASH} className="text-action">去启用两步验证</Link>;
}

/** 工作区顶部提示条：系统要求管理员启用两步验证，而本会话还没有（会话接口 admin_2fa_required） */
export function Admin2faBanner() {
  return (
    <Callout tone="warning" title="需要先启用两步验证" actions={<GoEnable />}>
      系统要求管理员启用两步验证。启用之前，管理功能（/admin）的接口都会被拒绝。用通行密钥登录的会话不受此限制。
    </Callout>
  );
}

/** 管理页内容的替代：此时 /admin/* 接口一律 403 admin_2fa_required，直接说明并给出入口，而不是渲染一堆报错 */
export function Admin2faRequiredPage() {
  return (
    <>
      <PageHeader title="需要先启用两步验证" />
      <Callout tone="warning" title="管理功能暂时不可用" actions={<GoEnable />}>
        系统要求管理员启用两步验证。请先在“账号安全”里启用两步验证（启用后其他设备上的登录会话会失效），再回来使用管理功能。
      </Callout>
    </>
  );
}
