import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminRuleGroupDetail } from "@maillink/shared";
import { isApiError } from "../../../api/errors";
import { api } from "../../../api/instance";
import { adminRuleGroupQuery, queryKeys } from "../../../api/queries";
import { useToast } from "../../../ui";
import { issuesFromApiError } from "../issues";
import type { EditorContent } from "./editor-state";
import type { RuleGroupEditorState } from "./useRuleGroupEditor";

export type ExistingRuleGroup = { id: number; revision: number; links: number; grants: number };

type Options = {
  editor: RuleGroupEditorState;
  existing: ExistingRuleGroup | null;
  onCreated: (id: number) => void;
};

function toContent(group: AdminRuleGroupDetail): EditorContent {
  return { name: group.name, description: group.description ?? "", config: group.config };
}

/** 保存（新建 POST / 更新 PUT 带 revision）。409 revision_conflict 留给界面提示并提供重新加载；400 的 issues 并入问题清单 */
export function useSaveRuleGroup({ editor, existing, onCreated }: Options) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [current, setCurrent] = useState(existing);

  const adopt = (group: AdminRuleGroupDetail) => {
    setCurrent({ id: group.id, revision: group.revision, links: group.link_count, grants: group.grant_count });
    editor.rebase(toContent(group));
  };
  const mutation = useMutation({
    mutationFn: () => {
      const { name, description, config } = editor.content;
      const body = { name: name.trim(), description: description.trim() === "" ? null : description.trim(), config: config as Record<string, unknown> };
      return current === null ? api.createRuleGroup(body) : api.updateRuleGroup(current.id, { ...body, revision: current.revision });
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminRuleGroups });
      toast.success(current === null ? `已创建规则组「${response.rule_group.name}」` : "已保存，立即对引用它的链接和授权生效");
      if (current === null) onCreated(response.rule_group.id);
      else adopt(response.rule_group);
    },
    onError: (error) => {
      const server = issuesFromApiError(error);
      if (server) editor.setServerIssues([...server.errors, ...server.warnings]);
    },
  });
  const reload = useMutation({
    mutationFn: () => queryClient.fetchQuery({ ...adminRuleGroupQuery(current?.id ?? 0), staleTime: 0 }),
    onSuccess: (group) => {
      adopt(group);
      mutation.reset();
    },
  });
  return {
    existing: current,
    save: () => mutation.mutate(),
    saving: mutation.isPending,
    error: mutation.isError ? mutation.error : null,
    conflict: isApiError(mutation.error, "revision_conflict"),
    nameTaken: isApiError(mutation.error, "rule_group_name_taken"),
    reload: () => reload.mutate(),
    reloading: reload.isPending,
    reloadError: reload.isError ? reload.error : null,
  };
}
