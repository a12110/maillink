import * as RadixDialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type { AdminOAuthProvider } from "@maillink/shared";
import { api } from "../../../api/instance";
import { queryKeys } from "../../../api/queries";
import { Button, ErrorCallout, useToast } from "../../../ui";
import { describeSettingsError } from "../errors";
import {
  BasicFields,
  BehaviorFields,
  CallbackUrl,
  ClaimFields,
  CredentialFields,
  EditNotice,
  EndpointFields,
  PresetPicker,
} from "./ProviderFields";
import { draftFromProvider, emptyDraft, toCreateInput, toUpdateInput } from "./provider-form";
import type { ProviderDraft } from "./provider-form";

export type ProviderTarget = { mode: "create" } | { mode: "edit"; provider: AdminOAuthProvider };

type Props = {
  target: ProviderTarget | null;
  onClose: () => void;
  /** 保存成功；编辑停用后可能让一些用户没有登录方式 */
  onSaved: (strandedUserIds: number[]) => void;
};

function useSaveProvider(target: ProviderTarget, onSaved: Props["onSaved"], onClose: () => void) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (draft: ProviderDraft): Promise<number[]> => {
      if (target.mode === "create") {
        const input = toCreateInput(draft);
        if (!input.ok) throw new Error("表单校验未通过");
        await api.createOAuthProvider(input.value);
        return [];
      }
      const input = toUpdateInput(draft);
      if (!input.ok) throw new Error("表单校验未通过");
      return (await api.updateOAuthProvider(target.provider.id, input.value)).users_without_login_method;
    },
    onSuccess: async (stranded) => {
      toast.success(target.mode === "create" ? "提供方已添加" : "提供方已保存");
      // 公开配置里的 oauth_providers（登录页按钮）也要跟上
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.adminOAuthProviders }),
        client.invalidateQueries({ queryKey: queryKeys.publicConfig }),
      ]);
      onSaved(stranded);
      onClose();
    },
  });
}

function ProviderForm({ target, onSaved, onClose }: { target: ProviderTarget } & Pick<Props, "onSaved" | "onClose">) {
  const edit = target.mode === "edit" ? target.provider : null;
  const [draft, setDraft] = useState<ProviderDraft>(() => (edit ? draftFromProvider(edit) : emptyDraft()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveProvider(target, onSaved, onClose);
  const update = (patch: Partial<ProviderDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const fieldProps = { draft, errors, update, disabled: save.isPending };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = edit ? toUpdateInput(draft) : toCreateInput(draft);
    setErrors(result.ok ? {} : result.fields);
    if (result.ok) save.mutate(draft);
  };

  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <div className="dialog-body dialog-scroll">
        {edit ? <EditNotice /> : <PresetPicker update={update} />}
        <BasicFields {...fieldProps} />
        <EndpointFields {...fieldProps} />
        <CredentialFields {...fieldProps} secretSet={edit ? edit.client_secret_set : null} />
        <ClaimFields {...fieldProps} />
        <BehaviorFields {...fieldProps} />
        <CallbackUrl provider={edit} slug={draft.slug} />
        {Object.keys(errors).length > 0 ? <ErrorCallout title="有值不合法" message="请按字段下方的提示修改" detail="validation_error" /> : null}
        {save.isError ? <ErrorCallout title="保存失败" {...describeSettingsError(save.error)} /> : null}
      </div>
      <div className="dialog-foot">
        <Button disabled={save.isPending} onClick={onClose}>取消</Button>
        <Button type="submit" variant="primary" busy={save.isPending} busyLabel="保存中…">保存</Button>
      </div>
    </form>
  );
}

export function ProviderDialog({ target, onClose, onSaved }: Props) {
  return (
    <RadixDialog.Root open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="overlay" />
        <RadixDialog.Content className="dialog" data-wide="true">
          <div className="dialog-head">
            <RadixDialog.Title className="dialog-title">{target?.mode === "edit" ? `编辑提供方：${target.provider.name}` : "添加 OAuth 提供方"}</RadixDialog.Title>
          </div>
          <RadixDialog.Description className="dialog-desc dialog-lead">
            用户可以用这个第三方账号登录。client_secret 加密保存，不会回显。
          </RadixDialog.Description>
          {target ? (
            <ProviderForm key={target.mode === "edit" ? target.provider.id : "new"} target={target} onSaved={onSaved} onClose={onClose} />
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
