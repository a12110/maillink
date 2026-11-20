import { RULE_GROUP_API_LIMITS } from "@maillink/shared";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Button } from "../../../ui";

type Props = {
  name: string;
  nameError: string | null;
  /** 已保存的规则组才有用量；新建时为 null */
  usage: { links: number; grants: number } | null;
  changes: number;
  saving: boolean;
  /** 不为 null 时保存按钮禁用，原因写在 title 与旁边的提示里 */
  saveBlockedReason: string | null;
  onName: (name: string) => void;
  onDiscard: () => void;
  onSave: () => void;
};

function Usage({ usage }: { usage: Props["usage"] }) {
  if (usage === null) {
    return <div className="usage"><span>新规则组</span><small>保存后才能被链接和授权选用</small></div>;
  }
  return (
    <div className="usage">
      <span>被 <b>{usage.links}</b> 个链接、<b>{usage.grants}</b> 个授权使用</span>
      <small>保存后立即对它们生效</small>
    </div>
  );
}

/** 顶部固定栏：返回、名称、用量、未保存标记、放弃更改、保存（DESIGN「规则组编辑」：sticky 64px） */
export function EditorHeader(props: Props) {
  const { name, nameError, usage, changes, saving, saveBlockedReason, onName, onDiscard, onSave } = props;
  return (
    <header className="editor-head">
      <div className="titles">
        <h1 className="sr-only">{usage === null ? "新建规则组" : `编辑规则组：${name.trim() || "未命名"}`}</h1>
        <Link className="crumb" to="/admin/rule-groups"><ChevronLeft className="icon-sm" />规则组</Link>
        <input className="editor-name" value={name} aria-label="规则组名称" aria-invalid={nameError ? "true" : undefined} placeholder="规则组名称" maxLength={RULE_GROUP_API_LIMITS.nameMaxLength}
          onChange={(event) => onName(event.target.value)} />
        {nameError ? <span className="field-error">{nameError}</span> : null}
      </div>
      <Usage usage={usage} />
      {changes > 0 ? <span className="unsaved" role="status"><span className="dot" data-tone="warning" aria-hidden="true" />{changes} 处未保存</span> : null}
      <Button variant="ghost" disabled={changes === 0 || saving} onClick={onDiscard}>放弃更改</Button>
      <Button variant="primary" busy={saving} busyLabel="保存中…" disabled={saveBlockedReason !== null} title={saveBlockedReason ?? undefined} onClick={onSave}>保存</Button>
    </header>
  );
}
