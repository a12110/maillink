import type { ReactNode } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

type PageHeaderProps = { title: string; summary?: ReactNode };

/** 页面头一行：标题 + 摘要；同时设置浏览器标题 */
export function PageHeader({ title, summary }: PageHeaderProps) {
  useDocumentTitle(title);
  return (
    <header className="page-head">
      <h1 className="page-title">{title}</h1>
      {summary ? <p className="summary">{summary}</p> : null}
    </header>
  );
}
