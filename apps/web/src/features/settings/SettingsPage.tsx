import { Link, useParams } from "@tanstack/react-router";
import { PageHeader } from "../../shell/PageHeader";
import { NotFoundPage } from "../../shell/StatusPages";
import { AppearanceForm } from "./AppearanceForm";
import { AuthForm } from "./AuthForm";
import { findNavItem, SETTINGS_NAV } from "./groups";
import type { SettingsNavKey } from "./groups";
import { OAuthProviders } from "./oauth/OAuthProviders";
import { LinksForm, LogsForm, PrewarmForm, SecurityForm } from "./SimpleForms";
import { SiteForm } from "./SiteForm";
import { SystemPanel } from "./SystemPanel";
import { TurnstileForm } from "./TurnstileForm";

const GROUP_BODIES: Record<SettingsNavKey, () => React.JSX.Element> = {
  site: SiteForm,
  appearance: AppearanceForm,
  auth: AuthForm,
  turnstile: TurnstileForm,
  oauth: OAuthProviders,
  security: SecurityForm,
  links: LinksForm,
  logs: LogsForm,
  prewarm: PrewarmForm,
  system: SystemPanel,
};

/** 系统设置：左侧分组导航 + 右侧表单；每组独立读取与保存 */
export function SettingsPage() {
  const { group } = useParams({ strict: false });
  const item = group === undefined ? undefined : findNavItem(group);
  if (!item) return <NotFoundPage />;
  const Body = GROUP_BODIES[item.key];
  return (
    <>
      <PageHeader title="系统设置" />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分组">
          {SETTINGS_NAV.map((entry) => (
            <Link key={entry.key} to="/admin/settings/$group" params={{ group: entry.key }} className="settings-nav-item">
              {entry.label}
            </Link>
          ))}
        </nav>
        <section className="settings-body" aria-labelledby="settings-group-title">
          <h2 className="section-heading" id="settings-group-title">{item.label}</h2>
          <p className="section-lead">{item.lead}</p>
          <Body key={item.key} />
        </section>
      </div>
    </>
  );
}
