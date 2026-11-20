import { strict as assert } from "node:assert";
import { budgetKeys, resetBudgetLog } from "./budget";

/** 归类自检：几条已知路径必须算对（防止路由表转换出错而静默少算） */
function selfCheck(): void {
  assert.deepEqual(budgetKeys("POST", "/api/auth/login", { username: " Alice " }), ["login:ip", "login:user:alice"]);
  assert.deepEqual(budgetKeys("POST", "/api/auth/mfa/totp", {}), ["mfa:ip"]);
  assert.deepEqual(budgetKeys("POST", "/api/auth/passkey/verify", {}), ["passkey:ip"]);
  assert.deepEqual(budgetKeys("DELETE", "/api/me/passkeys/1", null), ["passkey-manage:ip"]);
  assert.deepEqual(budgetKeys("POST", "/api/me/totp/enable", {}), ["reauth:ip"]);
  assert.deepEqual(budgetKeys("POST", "/api/setup", {}), ["setup:ip"]);
  assert.deepEqual(budgetKeys("GET", "/api/admin/users", null), []);
  assert.deepEqual(budgetKeys("GET", "/api/auth/login", null), []);
  assert.deepEqual(budgetKeys("POST", "/api/auth/loginx", {}), []);
}

export default function globalSetup(): void {
  selfCheck();
  resetBudgetLog();
}
