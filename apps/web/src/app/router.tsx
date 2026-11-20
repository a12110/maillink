import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AccountPage } from "../features/account/AccountPage";
import { LoginPage } from "../features/auth/LoginPage";
import { parseOAuthResultSearch } from "../features/auth/search";
import { InboxPage } from "../features/inbox/InboxPage";
import { parseInboxSearch } from "../features/inbox/search";
import { SetupPage } from "../features/auth/SetupPage";
import { RegisterPage } from "../features/register/RegisterPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { parseMailsSearch } from "../features/mails/search";
import { parseNewRuleGroupSearch } from "../features/rule-groups/new-search";
import { MailsPage } from "../features/mails/MailsPage";
import { MailsRouteError } from "../features/mails/MailsRouteError";
import { UsersPage } from "../features/users/UsersPage";
import { AdminLayout } from "../shell/AdminLayout";
import { AuthShell } from "../shell/AuthShell";
import { PickupShell } from "../shell/PickupShell";
import { PlaceholderPage } from "../shell/PlaceholderPage";
import { NotFoundPage, RouteErrorPage } from "../shell/StatusPages";
import { WorkspaceShell } from "../shell/WorkspaceShell";
import { queryClient } from "./query-client";
import { guardSetup, redirectFromRoot, redirectIfSignedIn, requireAdminSession, requireSession } from "./guards";
import type { RouterContext } from "./guards";

const rootRoute = createRootRouteWithContext<RouterContext>()({
  beforeLoad: guardSetup,
  component: Outlet,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ context }) => redirectFromRoot(context),
});

// ── 认证外壳 ──
const authLayout = createRoute({ getParentRoute: () => rootRoute, id: "auth", component: AuthShell });
const setupRoute = createRoute({ getParentRoute: () => authLayout, path: "/setup", component: SetupPage });
const loginRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/login",
  validateSearch: parseOAuthResultSearch,
  beforeLoad: ({ context }) => redirectIfSignedIn(context),
  component: () => <LoginPage />,
});
const registerRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/register",
  beforeLoad: ({ context }) => redirectIfSignedIn(context),
  component: RegisterPage,
});

// ── 取件页外壳（页面在 M3b 之后实现） ──
const pickupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$token",
  component: () => (
    <PickupShell>
      <h1 className="page-title">取件页</h1>
      <p className="auth-lead">取件页将在后续里程碑实现，本页暂不显示任何邮件内容。</p>
    </PickupShell>
  ),
});

// ── 工作区外壳：需要登录 ──
const workspaceLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "workspace",
  beforeLoad: ({ context }) => requireSession(context),
  component: WorkspaceShell,
});
const inboxRoute = createRoute({
  getParentRoute: () => workspaceLayout,
  path: "/inbox",
  validateSearch: parseInboxSearch,
  component: InboxPage,
});
const accountRoute = createRoute({
  getParentRoute: () => workspaceLayout,
  path: "/account",
  validateSearch: parseOAuthResultSearch,
  component: () => <AccountPage />,
});

// ── /admin/*：需要管理员 ──
const adminLayout = createRoute({
  getParentRoute: () => workspaceLayout,
  path: "/admin",
  beforeLoad: ({ context }) => requireAdminSession(context),
  component: AdminLayout,
});
const adminIndexRoute = createRoute({
  getParentRoute: () => adminLayout,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/admin/mailboxes" });
  },
});
const usersRoute = createRoute({ getParentRoute: () => adminLayout, path: "/users", component: UsersPage });
const mailsRoute = createRoute({
  getParentRoute: () => adminLayout,
  path: "/mails",
  validateSearch: parseMailsSearch,
  component: MailsPage,
  errorComponent: MailsRouteError,
});

function placeholder<const P extends string>(path: P, title: string, description: string) {
  return createRoute({
    getParentRoute: () => adminLayout,
    path,
    component: () => <PlaceholderPage title={title} description={description} />,
  });
}

const settingsIndexRoute = createRoute({
  getParentRoute: () => adminLayout,
  path: "/settings",
  beforeLoad: () => {
    throw redirect({ to: "/admin/settings/$group", params: { group: "site" } });
  },
});

// 本期新增的管理页按路由拆包（规则组编辑器带着 shared 的校验与正则分析，体积最大）
const mailboxesRoute = createRoute({
  getParentRoute: () => adminLayout,
  path: "/mailboxes",
  component: lazyRouteComponent(() => import("../features/mailboxes/MailboxesPage"), "MailboxesPage"),
});

const auditRoute = createRoute({
  getParentRoute: () => adminLayout,
  path: "/audit",
  component: lazyRouteComponent(() => import("../features/audit/AuditPage"), "AuditPage"),
});
const ruleGroupsRoute = createRoute({
  getParentRoute: () => adminLayout,
  path: "/rule-groups",
  component: lazyRouteComponent(() => import("../features/rule-groups/RuleGroupsPage"), "RuleGroupsPage"),
});
// 静态的 /new 优先于 /$id
const newRuleGroupRoute = createRoute({
  getParentRoute: () => adminLayout,
  path: "/rule-groups/new",
  validateSearch: parseNewRuleGroupSearch,
  component: lazyRouteComponent(() => import("../features/rule-groups/RuleGroupEditPage"), "NewRuleGroupPage"),
});
const editRuleGroupRoute = createRoute({
  getParentRoute: () => adminLayout,
  path: "/rule-groups/$id",
  component: lazyRouteComponent(() => import("../features/rule-groups/RuleGroupEditPage"), "RuleGroupEditPage"),
});
const settingsGroupRoute = createRoute({ getParentRoute: () => adminLayout, path: "/settings/$group", component: SettingsPage });

const adminPlaceholders = [
  placeholder("/links", "取件链接", "取件链接的创建与管理将在后续里程碑实现，本页暂不显示任何数据。"),
];

const routeTree = rootRoute.addChildren([
  indexRoute,
  authLayout.addChildren([setupRoute, loginRoute, registerRoute]),
  pickupRoute,
  workspaceLayout.addChildren([
    inboxRoute,
    accountRoute,
    adminLayout.addChildren([
      adminIndexRoute,
      usersRoute,
      mailsRoute,
      mailboxesRoute,
      ruleGroupsRoute,
      newRuleGroupRoute,
      editRuleGroupRoute,
      auditRoute,
      settingsIndexRoute,
      settingsGroupRoute,
      ...adminPlaceholders,
    ]),
  ]),
]);

/** 路由实例工厂：应用用浏览器 history，测试传内存 history 与独立的 queryClient */
export function createAppRouter(options: { history?: RouterHistory; client?: QueryClient } = {}) {
  return createRouter({
    routeTree,
    history: options.history,
    context: { queryClient: options.client ?? queryClient },
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
