import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { SettingsByGroup, WritableSettingGroup } from "@maillink/shared";
import { api } from "../../api/instance";
import { settingsGroupQuery } from "../../api/queries";
import { Button, ErrorCallout, Tag, useToast } from "../../ui";
import { describeSettingsError } from "./errors";
import { countChanged, specFor } from "./form-model";
import type { DraftByGroup } from "./form-model";
import { syncPublicConfig } from "./public-config-sync";

export type FormContext<G extends WritableSettingGroup> = {
  draft: DraftByGroup[G];
  update: (patch: Partial<DraftByGroup[G]>) => void;
  /** 字段名 → 就地错误（客户端校验） */
  errors: Record<string, string>;
  disabled: boolean;
  /** 已保存的值（GET 返回，turnstile 的 secret_set 等只读信息在这里） */
  saved: SettingsByGroup[G];
};

type GroupFormProps<G extends WritableSettingGroup> = {
  group: G;
  children: (context: FormContext<G>) => ReactNode;
  /** 前端已知保存必失败时的说明：显示出来并禁用保存（如强调色不可达） */
  blocker?: (draft: DraftByGroup[G]) => string | null;
};

function useSave<G extends WritableSettingGroup>(group: G, onSaved: (next: SettingsByGroup[G]) => void) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.putSettings<G>>[1]) => api.putSettings(group, input),
    onSuccess: async (next) => {
      onSaved(next);
      toast.success("设置已保存");
      await syncPublicConfig(client, group, next);
    },
  });
}

function Loaded<G extends WritableSettingGroup>({ group, initial, children, blocker }: GroupFormProps<G> & { initial: SettingsByGroup[G] }) {
  const spec = specFor(group);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => spec.toDraft(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSave(group, (next) => {
    setSaved(next);
    setDraft(spec.toDraft(next));
  });
  const changed = countChanged(draft, spec.toDraft(saved));
  const blocked = blocker?.(draft) ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = spec.toInput(draft);
    if (!result.ok) {
      setErrors(result.fields);
      setFormError(result.form);
      return;
    }
    setErrors({});
    setFormError(null);
    save.mutate(result.value);
  };
  const revert = () => {
    setDraft(spec.toDraft(saved));
    setErrors({});
    setFormError(null);
    save.reset();
  };

  return (
    <form className="settings-form" onSubmit={submit} noValidate>
      {children({ draft, update: (patch) => setDraft({ ...draft, ...patch }), errors, disabled: save.isPending, saved })}
      {formError ? <ErrorCallout title="有值不合法" message={formError} detail="validation_error" /> : null}
      {blocked ? <ErrorCallout title="无法保存" message={blocked} detail="accent_unreachable" /> : null}
      {save.isError ? <ErrorCallout title="保存失败" {...describeSettingsError(save.error)} /> : null}
      <div className="form-actions">
        <Button type="submit" variant="primary" busy={save.isPending} busyLabel="保存中…" disabled={changed === 0 || blocked !== null}>
          保存
        </Button>
        <Button onClick={revert} disabled={changed === 0 || save.isPending}>撤销修改</Button>
        {changed > 0 ? <Tag tone="warning">未保存 {changed} 处</Tag> : null}
      </div>
    </form>
  );
}

/** 一个设置分组的表单：读取 → 草稿 → 校验 → 整组保存；错误就地显示，保存成功后同步公开配置缓存 */
export function SettingsGroupForm<G extends WritableSettingGroup>(props: GroupFormProps<G>) {
  const query = useQuery(settingsGroupQuery(props.group));
  if (query.isError) {
    return <ErrorCallout title="设置读取失败" {...describeSettingsError(query.error)} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) return <span className="skeleton" aria-label="加载中" />;
  return <Loaded {...props} initial={query.data} />;
}
