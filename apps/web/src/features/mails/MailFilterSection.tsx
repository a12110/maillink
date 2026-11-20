import { ListFilter } from "lucide-react";
import { useId, useState } from "react";
import { DESKTOP_MEDIA_QUERY } from "../../constants";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Button } from "../../ui";
import { MailFilterBar } from "./MailFilterBar";
import { normalizeFilters } from "./search";
import type { MailFilters } from "./search";

type MailFilterSectionProps = { filters: MailFilters; onChange: (filters: MailFilters) => void };

/** 桌面：筛选栏常驻；窄屏：收成一个“筛选（N）”按钮（N = 生效的条件数），点开才占版面 */
export function MailFilterSection({ filters, onChange }: MailFilterSectionProps) {
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = Object.keys(normalizeFilters(filters)).length;
  const bar = <MailFilterBar filters={filters} onChange={onChange} />;
  if (isDesktop) return <div className="mail-filter-section">{bar}</div>;
  return (
    <div className="mail-filter-section">
      <Button aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <ListFilter />
        {count > 0 ? `筛选（${count}）` : "筛选"}
      </Button>
      {/* 收起时仍保持挂载：输入到一半的草稿不丢 */}
      <div id={panelId} hidden={!open} className="mail-filter-panel">
        {bar}
      </div>
    </div>
  );
}
