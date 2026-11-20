import { Link } from "@tanstack/react-router";
import { describeError } from "../../lib/messages";
import { PageHeader } from "../../shell/PageHeader";
import { ErrorCallout } from "../../ui";

/** /admin/mails 的路由错误（主要是 URL 参数不合法）：留在工作区里，说明原因，并给出一个回到无筛选列表的出口 */
export function MailsRouteError({ error }: { error: unknown }) {
  return (
    <>
      <PageHeader title="全部邮件" />
      <div className="form-stack">
        <ErrorCallout title="这个地址里的筛选参数无法使用" {...describeError(error)} />
        <div className="form-actions">
          <Link to="/admin/mails" search={{}} className="btn" data-variant="primary">
            清除筛选
          </Link>
        </div>
      </div>
    </>
  );
}
