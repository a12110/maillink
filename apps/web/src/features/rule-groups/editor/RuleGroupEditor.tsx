import { useBlocker } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { isApiError } from "../../../api/errors";
import { Callout, Segmented, TextField } from "../../../ui";
import { Tester } from "../tester/Tester";
import { descriptionProblem, nameProblem } from "./editor-state";
import type { EditorContent, EditorMode } from "./editor-state";
import { EditorHeader } from "./EditorHeader";
import { FilterSection } from "./FilterSection";
import { IssueSummary } from "./IssueSummary";
import { JsonEditor } from "./JsonEditor";
import { LimitsSection } from "./LimitsSection";
import { PresentSection } from "./PresentSection";
import { SaveErrors } from "./SaveErrors";
import { TimeSection } from "./TimeSection";
import { useRuleGroupEditor } from "./useRuleGroupEditor";
import type { RuleGroupEditorState } from "./useRuleGroupEditor";
import { useSaveRuleGroup } from "./useSaveRuleGroup";
import type { ExistingRuleGroup } from "./useSaveRuleGroup";
import { errorsOf } from "../issues";

const MODE_OPTIONS: ReadonlyArray<{ value: EditorMode; label: string }> = [
  { value: "form", label: "表单" },
  { value: "json", label: "JSON" },
];

const LEAVE_PROMPT = "有未保存的修改，离开后会丢失。确定离开吗？";

function FormSections({ editor }: { editor: RuleGroupEditorState }) {
  const { form, issues, edit } = editor;
  if (!form) return null;
  return (
    <>
      <TimeSection config={form} issues={issues} onChange={edit} />
      <FilterSection config={form} issues={issues} onChange={edit} onOpenJson={() => void editor.switchMode("json")} />
      <PresentSection config={form} issues={issues} onChange={edit} />
      <LimitsSection config={form} issues={issues} onChange={edit} />
    </>
  );
}

/** 表单 / JSON 切换；切回表单被拒（JSON 有语法错误或结构不合法）的原因由调用方显示在这一行下面 */
function ModeSwitch({ editor, onRefused }: { editor: RuleGroupEditorState; onRefused: (reason: string | null) => void }) {
  return (
    <div className="mode-switch">
      <Segmented legend="编辑方式" name="editor-mode" value={editor.mode} options={MODE_OPTIONS} hint="not、多层嵌套请用 JSON"
        onChange={(mode) => onRefused(editor.switchMode(mode))} />
    </div>
  );
}

/** 保存按钮禁用的原因（写在 title 上）；可以保存返回 null */
function saveBlockedReason(problems: number, isExisting: boolean, dirty: boolean): string | null {
  if (problems > 0) return `有 ${problems} 个问题需要先解决`;
  return isExisting && !dirty ? "没有改动" : null;
}

type Saver = ReturnType<typeof useSaveRuleGroup>;

type ColumnProps = { editor: RuleGroupEditorState; saver: Saver; descError: string | null; notes: readonly string[]; banner: ReactNode };

/** 左列：横幅 / 草稿说明 / 保存错误 / 问题清单 / 说明与编辑方式 / 四段表单（或 JSON） */
function EditorColumn({ editor, saver, descError, notes, banner }: ColumnProps) {
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <div className="sections">
      {banner}
      {notes.length > 0 ? (
        <Callout tone="info" title="这是从邮件生成的草稿，保存前请逐条确认" actions={<ul className="note-list">{notes.map((note) => <li key={note}>{note}</li>)}</ul>} />
      ) : null}
      <SaveErrors error={saver.error} conflict={saver.conflict} nameTaken={saver.nameTaken} invalidConfig={isApiError(saver.error, "rule_group_invalid")}
        reloading={saver.reloading} reloadError={saver.reloadError} onReload={saver.reload} />
      <IssueSummary issues={editor.issues} />
      <div className="editor-meta">
        <TextField label="说明（可选）" value={editor.content.description} error={descError ?? undefined} placeholder="这个规则组给谁用、为什么这样配"
          onChange={(event) => editor.setDescription(event.target.value)} />
        <ModeSwitch editor={editor} onRefused={setRefusal} />
      </div>
      {refusal && editor.mode === "json" ? <Callout tone="warning" title="暂时不能切回表单">{refusal}</Callout> : null}
      {editor.mode === "form" ? <FormSections editor={editor} /> : <JsonEditor text={editor.jsonText} parseError={editor.jsonError} issues={editor.issues} onChange={editor.editJson} />}
    </div>
  );
}

type Props = {
  existing: ExistingRuleGroup | null;
  initial: EditorContent;
  notes?: readonly string[];
  /** 显示在顶部固定栏下面（如“这个规则组现在无法通过校验”） */
  banner?: ReactNode;
  onCreated: (id: number) => void;
};

export function RuleGroupEditor({ existing, initial, notes = [], banner = null, onCreated }: Props) {
  const editor = useRuleGroupEditor(initial);
  // 新建成功后立刻跳到编辑页：此时本页内容已入库，不该再弹“有未保存的修改”
  const leaving = useRef(false);
  const saver = useSaveRuleGroup({ editor, existing, onCreated: (id) => { leaving.current = true; onCreated(id); } });
  const errorCount = errorsOf(editor.issues).length;
  const nameError = nameProblem(editor.content.name) ?? (saver.nameTaken ? "已有同名规则组，换一个名称" : null);
  const descError = descriptionProblem(editor.content.description);
  const dirty = editor.changes > 0;
  useBlocker({ shouldBlockFn: () => dirty && !leaving.current && !window.confirm(LEAVE_PROMPT), enableBeforeUnload: () => dirty && !leaving.current });
  const problems = errorCount + (nameError ? 1 : 0) + (descError ? 1 : 0);
  return (
    <>
      <EditorHeader name={editor.content.name} nameError={nameError} changes={editor.changes} saving={saver.saving}
        usage={saver.existing ? { links: saver.existing.links, grants: saver.existing.grants } : null}
        saveBlockedReason={saveBlockedReason(problems, saver.existing !== null, dirty)}
        onName={editor.setName} onDiscard={editor.discard} onSave={saver.save} />
      <div className="editor">
        <EditorColumn editor={editor} saver={saver} descError={descError} notes={notes} banner={banner} />
        <Tester config={editor.content.config} />
      </div>
    </>
  );
}
