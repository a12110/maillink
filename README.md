# MailLink

部署在 Cloudflare Workers 上的"取件链接"系统：读取 cloudflare_temp_email 的 D1 邮件库（只读），按规则组生成取件链接。设计文档见 `docs/design/README.md`。

## 本地开发

需要 Node ≥ 22.18、pnpm 10。全程只用本地模式（本地 D1 存放在 `apps/worker/.wrangler/state`），不会连接 Cloudflare。

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
# 需要先 POST /api/setup 初始化管理员并登录，见下方"本地登录"
```

### 本地登录

`apps/worker/.dev.vars` 里需要 `APP_SECRET`（至少 32 字符）与 `SETUP_TOKEN`；`PUBLIC_ORIGIN` 要和访问地址一致（默认 `http://localhost:8787`，换端口时在 `.dev.vars` 里覆盖）。

```sh
B=http://localhost:8787
H=(-H "Origin: $B" -H "X-MailLink-Csrf: 1" -H "Content-Type: application/json")
curl -s $B/api/setup/status
curl -s "${H[@]}" -X POST $B/api/setup -d '{"username":"admin","password":"至少10个字符","setup_token":"<SETUP_TOKEN>"}'
curl -s -c jar.txt "${H[@]}" -X POST $B/api/auth/login -d '{"username":"admin","password":"至少10个字符"}'
curl -s -b jar.txt $B/api/admin/system/health
```

### 前端联调

写请求的 CSRF 校验要求浏览器的 `Origin` 等于 Worker 的 `PUBLIC_ORIGIN`，所以**浏览器访问哪个地址，`PUBLIC_ORIGIN` 就必须设成哪个地址**。两种方式任选：

1. **同源（最简单）**：`pnpm --filter web build` 后启动 Worker，它会直接服务 `apps/web/dist`。默认就是 `http://localhost:8787`；换端口时用 `--var` 覆盖，例如
   `pnpm --filter worker dev --port 8794 --var PUBLIC_ORIGIN:http://localhost:8794`，然后访问 `http://localhost:8794`。改了前端代码要重新 `build`。
2. **Vite 热更新**：Vite 在 5173（`--port` 可改）并把 `/api` 代理给 Worker，此时 Worker 的 `PUBLIC_ORIGIN` 要设成 **Vite 的地址**，否则登录、新建用户等写操作会被 403 拒绝：
   ```sh
   # 终端 1：Worker 监听 8787，但声明自己的公开地址是 Vite 的
   pnpm --filter worker dev --var PUBLIC_ORIGIN:http://localhost:5173
   # 终端 2：Vite（默认代理到 http://localhost:8787；Worker 不在 8787 时用 WORKER_ORIGIN 指定）
   pnpm --filter web dev
   WORKER_ORIGIN=http://localhost:8794 pnpm --filter web dev --port 5174   # 例：Worker 在 8794、Vite 在 5174
   ```
   Vite 的代理保持浏览器发出的 `Origin` / `Host` 不变（`changeOrigin: false`）。

首次访问会进入 `/setup`：填用户名、密码与 `.dev.vars` 里的 `SETUP_TOKEN` 创建管理员，随后到 `/login` 登录。

预览主题（不持久化）：在任意页面地址后加 `?theme=light|dark|system`、`&radius=0|4|8`、`&accent=%232f5fa8`；非法值会直接报错。系统设置里的外观接口在 M6 接入。

### 校验

```sh
pnpm typecheck   # 全仓类型检查
pnpm lint        # 全仓 lint
pnpm test        # 单元测试（vitest + @cloudflare/vitest-plugin，本地 D1，单测 60 秒超时）
```

### 说明

- `MAIL_DB` 在代码里只读：`apps/worker/src/mail-source/` 是唯一接触它的目录，有单测扫描该目录禁止写入类 SQL。迁移只针对 `APP_DB`。
- 合成邮件样本在 `apps/worker/test/fixtures/`，见其中的 README。
- `/api/admin/*` 全部要求管理员会话；写操作还需 `Origin` 等于 `PUBLIC_ORIGIN` 且带请求头 `X-MailLink-Csrf: 1`。
