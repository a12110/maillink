import { Hono } from "hono";
import type { MyIdentity, OkResponse } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { deleteOwnIdentity, identityExists, listUserIdentities } from "../db/identities";
import type { IdentityWithProvider } from "../db/identities";
import type { AppEnv } from "../env";
import { notFoundError } from "../errors";
import { parseIdParam } from "../validate";
import { lastLoginMethodError } from "./me-passkeys";

// /api/me/identities：OAuth 绑定列表与解绑（至少保留一种登录方式）。绑定走 /api/auth/oauth/:slug/start?mode=link。

export const meIdentityRoutes = new Hono<AppEnv>();

export function toMyIdentity(row: IdentityWithProvider): MyIdentity {
  return {
    id: row.id,
    provider: { slug: row.slug, name: row.provider_name, icon: row.icon },
    email: row.email,
    display_name: row.display_name,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

meIdentityRoutes.get("/", async (c) => {
  const rows = await listUserIdentities(c.env.APP_DB, c.var.auth.user.id);
  return c.json({ items: rows.map(toMyIdentity) });
});

meIdentityRoutes.delete("/:id", async (c) => {
  const db = c.env.APP_DB;
  const { user } = c.var.auth;
  const id = parseIdParam(c);
  if (!(await deleteOwnIdentity(db, user.id, id))) {
    if (!(await identityExists(db, user.id, id))) throw notFoundError("绑定不存在");
    throw lastLoginMethodError();
  }
  await recordAudit(c, { action: AUDIT_ACTIONS.identityUnlink, actorUserId: user.id, targetType: "identity", targetId: id });
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});
