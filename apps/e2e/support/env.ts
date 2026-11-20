// 端到端测试的固定参数。APP_SECRET / SETUP_TOKEN 是测试专用的假值，只在每次运行都新建的临时数据里生效，
// 不对应任何真实环境（真实值永远不要写进仓库）。

export const E2E_PORT = 8817;
export const ORIGIN = `http://localhost:${E2E_PORT}`;
export const APP_SECRET = "e2e-app-secret-0123456789abcdef0123456789abcdef";
export const SETUP_TOKEN = "e2e-setup-token-0123456789abcdef";
