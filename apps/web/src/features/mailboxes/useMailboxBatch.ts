import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MailboxBatchRequest } from "@maillink/shared";
import { api } from "../../api/instance";
import { queryKeys } from "../../api/queries";
import { useToast } from "../../ui";
import { summarizeBatch } from "./batch-state";
import type { BatchSummary } from "./batch-state";
import type { Selection } from "./useMailboxSelection";

const SUCCESS_TEXT: Record<MailboxBatchRequest["action"], string> = {
  add_tags: "已打标签",
  remove_tags: "已去标签",
  enable: "已启用",
  disable: "已停用",
  delete: "已删除",
};

/** 批量操作：成功的部分更新选择与列表，失败的逐条留在 `failures` 里就地显示 */
export function useMailboxBatch(selection: Selection) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [failures, setFailures] = useState<BatchSummary["failures"]>([]);
  const mutation = useMutation({
    mutationFn: (request: MailboxBatchRequest) => api.batchMailboxes(request),
    onSuccess: async (response, request) => {
      const summary = summarizeBatch(response.results, selection.selected);
      setFailures(summary.failures);
      // 删除成功的行已不存在，从选择里去掉（失败的留着方便重试）；其余操作保留选择，方便接着做下一个操作
      if (request.action === "delete") {
        const failedIds = new Set(summary.failures.map((f) => f.id));
        selection.setMany([...selection.selected.values()].filter((m) => !failedIds.has(m.id)), false);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminMailboxes });
      if (summary.ok > 0) toast.success(`${SUCCESS_TEXT[request.action]} ${summary.ok} 个地址`);
    },
  });
  return { mutation, failures, dismissFailures: () => setFailures([]) };
}
