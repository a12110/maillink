import type { D1Migration } from "cloudflare:test";
import type { Bindings } from "../src/env";

declare global {
  // worker 包没有直接依赖 vite，这里只声明测试用到的 import.meta.glob 形态
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }

  namespace Cloudflare {
    interface Env extends Bindings {
      /** 仅测试：由 vitest.config.ts 注入的 APP_DB 迁移 */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
