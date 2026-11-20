import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MailboxImportResponse } from "@maillink/shared";
import { api } from "../../api/instance";
import { queryKeys } from "../../api/queries";
import { describeError } from "../../lib/messages";
import { FormDialog, useToast } from "../../ui";
import { ImportInputStep } from "./ImportInputStep";
import type { ImportInput } from "./ImportInputStep";
import { ImportPreviewStep } from "./ImportPreviewStep";
import { describeImportDrift } from "./import-state";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/** 预览（dry_run）与正式导入用同一份输入；预览之后再改输入必须重新预览，所以确认时不重发修改过的内容 */
function ImportFlow({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [input, setInput] = useState<ImportInput>({ content: "", tags: [] });
  const [preview, setPreview] = useState<MailboxImportResponse | null>(null);

  const request = { content: input.content, tags: input.tags };
  const previewMutation = useMutation({
    mutationFn: () => api.importMailboxes({ ...request, dry_run: true }),
    onSuccess: setPreview,
  });
  const confirmMutation = useMutation({
    mutationFn: () => api.importMailboxes({ ...request, dry_run: false }),
    onSuccess: async (done) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminMailboxes });
      const drift = preview ? describeImportDrift(preview, done) : null;
      const skipped = `跳过重复 ${done.summary.duplicate}、无效 ${done.summary.invalid}`;
      toast.success(`已导入 ${done.summary.new} 个地址，${skipped}${drift ? `。${drift}` : ""}`);
      onOpenChange(false);
    },
  });

  if (preview) {
    return (
      <ImportPreviewStep
        preview={preview}
        busy={confirmMutation.isPending}
        error={confirmMutation.isError ? describeError(confirmMutation.error) : null}
        onBack={() => {
          confirmMutation.reset();
          setPreview(null);
        }}
        onConfirm={() => confirmMutation.mutate()}
      />
    );
  }
  return (
    <ImportInputStep
      value={input}
      onChange={setInput}
      busy={previewMutation.isPending}
      error={previewMutation.isError ? describeError(previewMutation.error) : null}
      onCancel={() => onOpenChange(false)}
      onPreview={() => previewMutation.mutate()}
    />
  );
}

export function ImportDialog({ open, onOpenChange }: Props) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="导入收件地址"
      description="先预览会新增、跳过哪些地址，确认后才写入。"
    >
      <ImportFlow onOpenChange={onOpenChange} />
    </FormDialog>
  );
}
