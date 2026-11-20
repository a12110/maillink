import { useMutation } from "@tanstack/react-query";
import { Copy, Download } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/instance";
import { describeError, errorLine } from "../../lib/messages";
import { Button, Callout, ErrorCallout, Segmented, TextField } from "../../ui";
import { buildExportRequest, DEFAULT_TEMPLATE, exportFilename, TEMPLATE_VARIABLE_HINT, validateTemplate } from "./export-template";
import type { ExportFormat } from "./export-template";

function download(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ExportResult({ content, count, format }: { content: string; count: number; format: ExportFormat }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied("已复制到剪贴板");
    } catch (cause) {
      setCopied(`复制失败：${errorLine(cause)}`);
    }
  };
  return (
    <div className="export-result">
      <Callout tone="info" title={`已导出 ${count} 条`}>下面是完整内容，请复制或下载。</Callout>
      <textarea className="input export-text" readOnly value={content} aria-label="导出内容" onFocus={(event) => event.currentTarget.select()} />
      <div className="form-actions">
        <Button onClick={() => void copy()}><Copy />复制</Button>
        <Button onClick={() => download(content, exportFilename(format, new Date()), format === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8")}>
          <Download />
          下载文件
        </Button>
        {copied ? <span className="field-hint" role="status">{copied}</span> : null}
      </div>
    </div>
  );
}

/** 导出：CSV（address,note,link）或按行模板。导出由服务端生成并写审计；内容只保留在本对话框里 */
export function ExportPanel({ ids, primary = true }: { ids: number[]; /** 对话框里已有主按钮（如“完成”）时传 false，保持一屏一个主按钮 */ primary?: boolean }) {
  const [format, setFormat] = useState<ExportFormat>("template");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const templateError = format === "template" ? validateTemplate(template) : null;
  const exportLinks = useMutation({ mutationFn: () => api.exportLinks(buildExportRequest(ids, format, template)) });
  const result = exportLinks.data;
  return (
    <section className="export-panel" aria-label="导出">
      <Segmented
        legend="导出格式"
        name="export-format"
        value={format}
        options={[
          { value: "template", label: "按行模板" },
          { value: "csv", label: "CSV" },
        ]}
        onChange={setFormat}
        hint={format === "csv" ? "首行表头 address,note,link；多地址链接的地址与备注用 ; 连接。" : undefined}
      />
      {format === "template" ? (
        <TextField label="行模板" mono value={template} error={templateError ?? undefined} hint={`每个链接一行，可用变量 ${TEMPLATE_VARIABLE_HINT}；适合直接贴进发卡平台。`} onChange={(event) => setTemplate(event.target.value)} />
      ) : null}
      <p className="field-hint">导出会写入审计日志（记录导出了多少条）。内容只显示在这里，关闭后不保留。</p>
      <div>
        <Button variant={primary ? "primary" : "secondary"} disabled={templateError !== null} busy={exportLinks.isPending} busyLabel="导出中…" onClick={() => exportLinks.mutate()}>
          <Download />
          导出 {ids.length} 个链接
        </Button>
      </div>
      {exportLinks.isError ? <ErrorCallout title="导出失败" {...describeError(exportLinks.error)} /> : null}
      {result ? <ExportResult content={result.content} count={result.count} format={format} /> : null}
    </section>
  );
}
