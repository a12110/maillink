import { useId } from "react";
import { Lock } from "lucide-react";
import { EXTRACT_TARGETS } from "@maillink/shared";
import type { ExtractTarget, RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { Checkbox, TextField } from "../../../ui";
import { canExtractLoginLink } from "../config";
import { issuesAt } from "../issues";
import { FieldIssues } from "./FieldIssues";

type Props = { config: RuleGroupConfig; issues: readonly RuleGroupIssue[]; onChange: (update: (c: RuleGroupConfig) => RuleGroupConfig) => void };

const TARGET_LABEL: Record<ExtractTarget, string> = { code: "验证码", login_link: "登录链接" };

/** 验证码提取：显示哪些（验证码 / 登录链接）+ 自定义验证码正则 */
export function ExtractField({ config, issues, onChange }: Props) {
  const hintId = useId();
  const { extract, code_regex } = config.present;
  const loginAllowed = canExtractLoginLink(config);
  const toggle = (target: ExtractTarget, on: boolean) =>
    onChange((c) => ({ ...c, present: { ...c.present, extract: on ? [...c.present.extract, target] : c.present.extract.filter((t) => t !== target) } }));
  return (
    <div className="stack">
      <div className="row-inline" data-roomy="true" role="group" aria-label="验证码提取">
        {EXTRACT_TARGETS.map((target) => {
          const locked = target === "login_link" && !loginAllowed && !extract.includes(target);
          return (
            <Checkbox key={target} checked={extract.includes(target)} disabled={locked} aria-describedby={target === "login_link" ? hintId : undefined}
              onChange={(event) => toggle(target, event.target.checked)}>
              {locked ? <Lock className="icon-sm" aria-hidden="true" /> : null}
              {TARGET_LABEL[target]}
            </Checkbox>
          );
        })}
      </div>
      <p className="field-hint" id={hintId}>
        登录链接等于一次完整登录，比验证码更敏感，只给确实不发验证码的平台用。
        {loginAllowed ? "" : "要勾选它，先把“链接”改成只保留指定域名并填入域名。"}
      </p>
      <FieldIssues issues={issuesAt(issues, ["present", "extract"])} />
      <TextField label="自定义验证码正则（可选）" mono value={code_regex ?? ""} placeholder="例如 验证码[:：]\s*(\d{6})"
        hint="覆盖内置提取：先主题后正文，有捕获组取第 1 组，否则取整个匹配。留空 = 用内置提取。"
        error={issuesAt(issues, ["present", "code_regex"])[0]?.message}
        onChange={(event) => onChange((c) => {
          const { code_regex: _old, ...rest } = c.present;
          return { ...c, present: event.target.value === "" ? rest : { ...rest, code_regex: event.target.value } };
        })} />
    </div>
  );
}
