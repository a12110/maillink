# MailLink

部署在 Cloudflare Workers 上的"取件链接"系统：读取 cloudflare_temp_email 的 D1 邮件库（只读），按规则组生成取件链接。设计文档见 `docs/design/README.md`。

## 本地开发

需要 Node ≥ 22、pnpm 10。全程只用本地模式（本地 D1 存放在 `apps/worker/.wrangler/state`），不会连接 Cloudflare。

```sh
# 1. 安装依赖
pnpm install

# 2. 本地密钥：复制示例并填入值（apps/worker/.dev.vars 已被 .gitignore 忽略）
cp .dev.vars.example apps/worker/.dev.vars

# 3. 应用 APP_DB 迁移（仅本地）
pnpm --filter worker db:migrate

# 4. 本地 MAIL_DB 种子：用 cloudflare_temp_email 的 db/schema.sql 建表并灌入 5 封合成邮件
#    默认读取与本仓库同级的 ../cloudflare_temp_email/db/schema.sql，可用 TEMP_EMAIL_SCHEMA=/path/to/schema.sql 覆盖
#    可重复执行（会先清掉旧的种子行）
pnpm --filter worker db:seed-mail

# 5. 构建前端静态资源（Worker 的 ASSETS 指向 apps/web/dist）
pnpm --filter web build

# 6. 启动 Worker（含静态资源），默认 http://localhost:8787
pnpm --filter worker dev
curl -s http://localhost:8787/api/admin/system/health
```

前端热更新开发：先按上面启动 Worker，再另开终端 `pnpm --filter web dev`（Vite 会把 `/api` 代理到 `http://localhost:8787`）。

### 校验

```sh
pnpm typecheck   # 全仓类型检查
pnpm lint        # 全仓 lint
pnpm test        # 单元测试（vitest + @cloudflare/vitest-plugin，本地 D1，单测 60 秒超时）
```

### 说明

- `MAIL_DB` 在代码里只读：`apps/worker/src/mail-source/` 是唯一接触它的目录，有单测扫描该目录禁止写入类 SQL。迁移只针对 `APP_DB`。
- 合成邮件样本在 `apps/worker/test/fixtures/`，见其中的 README。
- `/api/admin/system/health` 目前没有鉴权（M1 加上），不要在未完成 M1 前部署。
