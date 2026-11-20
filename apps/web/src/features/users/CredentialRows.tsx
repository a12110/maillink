import type { AdminUserDetail } from "@maillink/shared";
import { formatDateTime } from "../../lib/format";
import { Button } from "../../ui";
import type { Removal } from "./credential-removal";

type Props = { user: AdminUserDetail; onRemove: (removal: Removal) => void };

function Passkeys({ user, onRemove }: Props) {
  if (user.passkeys.length === 0) return <li><span className="method-label">通行密钥：无</span></li>;
  return (
    <li>
      <div className="method-label">
        通行密钥：{user.passkeys.length} 把
        <ul className="method-sub">
          {user.passkeys.map((passkey) => (
            <li key={passkey.id}>
              <span className="method-label">{passkey.name} · {passkey.last_used_at === null ? "没用过" : `最近 ${formatDateTime(passkey.last_used_at)}`}</span>
              <Button size="sm" variant="danger-ghost" onClick={() => onRemove({ kind: "passkey", id: passkey.id, name: passkey.name })}>删除</Button>
            </li>
          ))}
        </ul>
      </div>
      <Button size="sm" variant="danger-ghost" onClick={() => onRemove({ kind: "passkey" })}>全部删除</Button>
    </li>
  );
}

function Identities({ user, onRemove }: Props) {
  if (user.identities.length === 0) return <li><span className="method-label">第三方账号：无</span></li>;
  return (
    <li>
      <div className="method-label">
        第三方账号：{user.identities.length} 个
        <ul className="method-sub">
          {user.identities.map((identity) => (
            <li key={identity.id}>
              <span className="method-label">{identity.provider.name}{identity.email ? ` · ${identity.email}` : ""}</span>
              <Button size="sm" variant="danger-ghost" onClick={() => onRemove({ kind: "identity", id: identity.id, name: identity.provider.name })}>解除</Button>
            </li>
          ))}
        </ul>
      </div>
      <Button size="sm" variant="danger-ghost" onClick={() => onRemove({ kind: "identity" })}>全部解除</Button>
    </li>
  );
}

/** 登录方式清单：每一项带各自的清除按钮（单个 / 全部） */
export function CredentialRows({ user, onRemove }: Props) {
  return (
    <ul className="method-list" aria-label="登录方式">
      <li><span className="method-label">密码：{user.login_methods.password ? "已设置" : "未设置"}</span></li>
      <li>
        <span className="method-label">两步验证：{user.login_methods.totp ? "已启用" : "未启用"}</span>
        {user.login_methods.totp ? <Button size="sm" variant="danger-ghost" onClick={() => onRemove({ kind: "totp" })}>清除</Button> : null}
      </li>
      <Passkeys user={user} onRemove={onRemove} />
      <Identities user={user} onRemove={onRemove} />
    </ul>
  );
}
