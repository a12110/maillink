import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, FormDialog } from "../../ui";
import { templateChoices } from "./config";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

const BLANK = { key: "blank", name: "空白", description: "白名单、没有规则：什么都看不到，从零开始自己加允许规则。" };

function TemplateList({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const choices = [...templateChoices(), BLANK];
  const [picked, setPicked] = useState("code_only");
  return (
    <div className="dialog-form">
      <div className="template-list" role="radiogroup" aria-label="起始模板">
        {choices.map((choice) => (
          <label key={choice.key} className="template-option" data-checked={picked === choice.key}>
            <input type="radio" name="template" value={choice.key} checked={picked === choice.key} onChange={() => setPicked(choice.key)} />
            <span className="template-name">{choice.name}</span>
            <span className="template-desc">{choice.description}</span>
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={() => void navigate({ to: "/admin/rule-groups/new", search: { template: picked } })}>用这个模板开始</Button>
      </div>
    </div>
  );
}

/** 新建规则组：从 6 个内置模板（或空白）选一个起步；模板只是初始值，进入编辑页后可随意改，保存前不会写入 */
export function NewRuleGroupDialog({ open, onOpenChange }: Props) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="新建规则组" description="选一个起点，进入编辑页后再改；保存之前不会创建。">
      <TemplateList onClose={() => onOpenChange(false)} />
    </FormDialog>
  );
}
