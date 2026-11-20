import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/instance";
import { linkKeys } from "../../api/links-queries";
import { buildCreateBody, EMPTY_DRAFT } from "./create-form";
import type { CreateDraft, FieldErrors } from "./create-form";

export const STEPS = ["收件地址", "规则组", "访问约束"] as const;
export const LAST_STEP = STEPS.length - 1;

/** 步骤 1、2 的必选项：选了地址 / 规则组才能往下走 */
function stepIssue(step: number, draft: CreateDraft): FieldErrors {
  if (step === 0 && draft.mailboxes.length === 0) return { mailboxes: "至少选择一个收件地址" };
  if (step === 1 && draft.ruleGroupId === null) return { ruleGroupId: "请选择规则组" };
  return {};
}

/** 创建向导的状态：草稿、步骤、字段错误、提交（成功后刷新列表缓存） */
export function useCreateForm(preselected: number[], onCreated: (ids: number[]) => void) {
  const [draft, setDraft] = useState<CreateDraft>({ ...EMPTY_DRAFT, mailboxes: preselected.map((id) => ({ id, address: null })) });
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createLinks>[0]) => api.createLinks(body),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: linkKeys.all });
      onCreated(result.items.map((item) => item.link.id));
    },
  });
  const patch = (next: Partial<CreateDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setErrors({});
  };
  const next = () => {
    const issue = stepIssue(step, draft);
    setErrors(issue);
    if (Object.keys(issue).length === 0) setStep(step + 1);
  };
  const submit = () => {
    const built = buildCreateBody(draft, Date.now());
    if (built.ok) return create.mutate(built.body);
    setErrors(built.errors);
    // 地址 / 规则组的问题在前两步，跳回去让用户看到
    if (built.errors.mailboxes) setStep(0);
    else if (built.errors.ruleGroupId) setStep(1);
  };
  return { draft, step, errors, create, patch, next, submit, back: () => setStep(step - 1) };
}
