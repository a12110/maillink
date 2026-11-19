import { Construction } from "lucide-react";
import { EmptyState } from "../ui";
import { PageHeader } from "./PageHeader";

type PlaceholderPageProps = { title: string; description: string };

/** 明确的占位：后端尚未实现的页面。不渲染任何假数据 */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} />
      <div className="panel">
        <EmptyState icon={Construction} title="本页将在后续里程碑实现" description={description} />
      </div>
    </>
  );
}
