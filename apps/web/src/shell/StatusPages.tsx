import { Link, useRouter } from "@tanstack/react-router";
import { Button, ErrorCallout } from "../ui";
import { describeError } from "../lib/messages";
import { AuthLayout } from "./AuthShell";
import { retryRoute } from "./retry";

export function NotFoundPage() {
  return (
    <AuthLayout>
      <h1>页面不存在</h1>
      <p className="auth-lead">地址可能已经变化，或者你没有权限访问。</p>
      <Link to="/" className="btn" data-variant="secondary" data-block="true">
        回到首页
      </Link>
    </AuthLayout>
  );
}

/** 路由加载失败（如 /api/setup/status 连不上）：就地显示原因与错误码，可重试 */
export function RouteErrorPage({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  return (
    <AuthLayout>
      <h1>页面加载失败</h1>
      <ErrorCallout title="无法完成加载" {...describeError(error)} />
      <Button variant="primary" block onClick={() => void retryRoute(router, reset)}>
        重试
      </Button>
    </AuthLayout>
  );
}
