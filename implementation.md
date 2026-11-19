# 实现方案（TinaCMS 自托管编辑）

> 对应需求 [task.md](task.md)。这里只写实现，不重复需求。

## 当前状态（2026-11-19）

- M1–M7 已实现；`public/admin` 已重建，包含新增控件（提交审核 / 放弃修改 / 状态，状态含分支，悬停显示 fork）。
- 迁移已执行：`tinacms-tina` 集合的 `tina` 命名空间 → `tinacms` 集合的 `main`（138 行，137 内容 + 1 元数据）；旧集合保留。
- 已验证：`main` 读取、draft 克隆/读取/删除、GraphQL 写入 draft 并缓冲、GitHub 临时分支提交/删除（依赖重装后复测）、`prepareWrite` 首次保存、关闭工作区在保存前清理、purge、锁、限流、服务启动、匿名访问 `/api/tina/workspace` 401、`/admin` 200。
- 已补的边界：保存前同步 PR 并清理 merged/closed；提交对已开 PR 幂等；fork 落后时 404/422 先 `merge-upstream` 再建分支；base sha 拿不到时仍先写 draft，commit 后续补取；GitHub 请求 20 秒超时；sweep 的异步异常不再冒泡。
- GitHub 授权：后端只能读取 Clerk 已保存的 OAuth token，不能在保存 XHR 里发起 OAuth。管理员状态区在 `github.error` 时显示“重新授权 GitHub”，调用 Clerk `createExternalAccount`/`reauthorize`（`public_repo`）；前提是 Clerk 已配置自定义 GitHub OAuth App，共享凭据不会返回 token。
- 仍需运维/人工：Clerk 自定义 GitHub OAuth App；真实账号首次登录并开 PR；合并后的索引重建（刷新 `main`，不在本仓库范围）。
- 构建前置：`pnpm-workspace.yaml` 的 `allowBuilds` 已把 esbuild/sharp/better-sqlite3 设为 true；`pnpm run build` 使用 [scripts/build.mjs](scripts/build.mjs) 的 `--skip-indexing`。

## 0. 起点与改造点

当前代码：

- `tina/database.ts`：一个 `Database`，`GitHubProvider` + `MongodbLevel`（`tinacms-tina`，namespace `tina`）。
- `server.ts`：`/api/tina/*` 全交给 `TinaNodeBackend`，其余走静态文件和 `/tina-island/*`。
- `tina/clerk-auth.ts`：只返回 `isAuthorized`，没有把 `userId` 写进 `req.session.user`。
- admin：`tinacms build` 生成到 `public/admin`，没有额外按钮。
- 媒体：`media.tina`，自托管下会抛错，要换 `media.tina.static`。
- `.env`：`MONGODB_URI` 已有；`UPSTASH_*` 是残留。

## 1. 代码结构

```text
tina/
├─ database.ts       导出 Proxy Database，按当前请求转发
├─ mongo.ts          MongoClient 单例（workspaces / locks / ratelimits）
├─ tenant.ts         getDb(namespace)、cloneDraft、deleteNamespace
├─ context.ts        AsyncLocalStorage：userId、login、token、buffer
├─ git-provider.ts   缓冲 onPut/onDelete，请求结束 flush 成 commit
├─ github.ts         fork/分支/commit/PR/删除分支的 REST 封装
├─ workspace.ts      workspaces 集合的读写、状态流转
├─ lock.ts           抢锁 / 释放
├─ ratelimit.ts      保存、PR 限流
├─ purge.ts          关闭/放弃/合并的清理
├─ sweep.ts          定时任务（10 分钟 + 每日不活跃）
└─ auth.ts           从请求里取 userId 和 GitHub token

server.ts            加 /api/tina/submit、/discard、/workspace；包 ALS 与 flush
tina/config.ts       媒体改 static
scripts/migrate-main.mjs  tina → main 迁移
patches/tinacms@3.15.2.patch  五个控件
```

## 2. 关键实现

### 2.1 按请求切 Database

- `MongodbLevel` 只建**一个**实例（`collectionName: tinacms`），所有 namespace 共用；`createDatabase` 每次传入同一个 level、不同 `namespace`。
- `database.ts` 导出 `Proxy`：`get(target, prop)` 从 ALS 取当前 `Database`，没有就取 `main`。这样 `tina/__generated__/databaseClient.ts` 不用改（它是生成文件）。
- `getDb(namespace)` 缓存（LRU，最多 100 个，空闲 10 分钟释放）；`purge` 后删缓存。
- ALS 在 `/api/tina` 的 Express 中间件里 `run()`；`isAuthorized` 成功后写入 `store.auth = { userId, login, token }`，同时 `req.session.user = { id: userId }`（Tina 会把它作为 `ctxUser` 传给 `resolve`）。

### 2.2 命名空间选择

- 请求开始时：`workspace.cloneDone` 为真 → `draft:<userId>`；否则 → `main`。
- 首次保存：先 `cloneDraft(userId)`，再切到 `draft`。
- `cloneDraft`：把 `_content!main!*` 与 `_metadata!main!*` 的全部 key 改前缀写入 `draft:<userId>`，标记 `cloneDone`。

### 2.3 缓冲 GitProvider

- `onPut` / `onDelete` 只把 `{ op, path }` 塞进 ALS 的 buffer，不发网络。
- 包一层 `databaseClient.request`：响应无 `errors` 且 buffer 非空 → `flushCommit()`；有 `errors` → 清空 buffer。
- `flushCommit()`：
  1. 确保 fork、确保分支（不存在就从基准 head 建）；
  2. `base_tree` + 变更文件建 blob/tree（删除项 `sha: null`）；
  3. 建 commit，更新 ref（`force: false`，422 时重取 head 重试一次）；
  4. 更新 workspace 的 `headSha`、`changedPaths`、`updatedAt`。
- 失败：workspace 记 `pendingCommit` 和 `pendingOps`，返回「已保存，提交稍后重试」。
- 重试：下次保存/提交/定时任务时，按 `pendingOps` 重新读 `draft` 内容再 commit。

### 2.4 工作区与锁

- `workspaces` 文档见 task.md §10.2；`_id = userId`。
- 锁：`locks.insertOne({ _id: userId, owner, expiresAt: now + 60s })`；`E11000` 即忙；释放 `deleteOne`。保存、提交、放弃、清理共用。
- 限流：`ratelimits` 用 `$inc` + `expireAt`；超限返回 429。

### 2.5 接口

在 `server.ts` 里，**先于** `tinaHandler` 注册：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/tina/workspace` | 返回 workspace + PR 状态（缓存 10~30s） |
| POST | `/api/tina/submit` | 开 PR（幂等） |
| POST | `/api/tina/discard` | 关 PR、删分支/draft/workspace |

鉴权复用 Clerk：从 `Authorization` 或 `tina_clerk_token` 取 token，`authenticateRequest` 拿 `userId`；再取 GitHub token 调 GitHub。

### 2.6 清理与定时

- `purge(userId)`：有打开 PR 先关；删分支（失败标 `purging`）；删 `draft` 前缀；删 workspace；清缓存。
- `sweep.ts`：
  - 每 10 分钟：`purging`、`pendingCommit`、submitted 的 PR 状态检查（merged/closed → purge）。
  - 每天：`updatedAt < now-7d` 且无打开 PR → purge。
- 服务启动时启动定时器；单实例部署（多实例要换成外部 cron 或加锁）。

### 2.7 admin 控件

- 用 `pnpm patch tinacms@3.15.2` 改 `dist/index.js`：在原有 Reset/Save 之后插入三个控件（提交审核、放弃修改、状态），加上原有的重置、保存，共五个。
- 状态每 30 秒拉一次 `GET /api/tina/workspace`；提交前若表单 dirty，先走 Tina 的 `handleSubmit`，检查 `FORM_ERROR` 后再 `POST /submit`。

### 2.8 媒体

`tina/config.ts` 改：

```ts
media: { tina: { static: true, mediaRoot: '', publicFolder: 'public' } }
```

### 2.9 迁移

`scripts/migrate-main.mjs`（已执行）：

1. 读 `tinacms-tina` 的 `_content!tina!*`、`_metadata!tina!*`；
2. key 里的 `!tina!` 换成 `!main!`，写入新集合 `tinacms`；
3. 校验条数 = 138；
4. 手动切配置后再删旧集合。

## 3. 依赖与配置

- `pnpm patch tinacms`（五控件）。
- Clerk：GitHub 自定义 OAuth App，scope `public_repo`（见 task.md §3）。
- `.env`：`MONGODB_URI`、`CLERK_SECRET_KEY`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`、`GITHUB_*`；删 `UPSTASH_*`。
- `GITHUB_PERSONAL_ACCESS_TOKEN` 只用于迁移/运维，不再用于用户操作；上线后撤销。

## 4. 实施顺序

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| M1 | mongo 单例、共享 level、`getDb`、迁移、读 `main` | ✅ 完成 |
| M2 | `req.session.user`、GitHub token 缓存、鉴权 helper | ✅ 完成 |
| M3 | workspaces / locks / ratelimits | ✅ 完成 |
| M4 | cloneDraft、缓冲 GitProvider、flush commit | ✅ 完成（临时分支验证过） |
| M5 | submit / status / discard | ✅ 完成（真实登录待验） |
| M6 | purge + sweep + merged/closed 检测 | ✅ 完成 |
| M7 | admin 五控件 patch | ✅ 完成，已重建 |
| M8 | 媒体 static、错误提示、测试 | 部分：媒体已改；端到端待真实账号 |

## 5. 测试

- 单元：key 前缀克隆/删除、commit tree 构造、限流窗口、锁冲突。
- 集成：本地 `TINA_PUBLIC_IS_LOCAL=false` + 测试 Mongo + 测试仓库（不要用主仓库）。
- 端到端：登录 → 打开 → 保存 → 提交 → 合并/关闭 → 清理。
- 检查：token 不出现在日志；draft 互不可见；重复提交不产生第二个 PR；清理幂等。

## 6. 风险

- **patch tinacms**：版本升级会冲突；锁 3.15.2，补丁只动一个组件。
- **按用户 Database 缓存**：内存随活跃用户增长；LRU 上限 + 空闲释放。
- **GitHub 限流**：状态检查缓存，避免每个请求都打 GitHub。
- **并发**：锁 TTL 120 秒，长请求可能被抢；保存/提交都短，够用。
- **admin 表单 dirty 判定**：提交审核时先调用 Tina 的 `handleSubmit`，检查 `FORM_ERROR` 后再开 PR。
- **基线刷新**：合并后 `main` 命名空间需要外部索引任务更新，否则下一位用户的草稿仍从旧基线克隆。

## 7. 上线前清单

- Clerk：用自定义 GitHub OAuth App（client id/secret，scope `public_repo`）替换共享凭据。
- 确认 `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH=tina`，仓库为公开库（`public_repo` 只能 fork 公开库）。
- 迁移已执行；确认 `tinacms` 集合 138 行；确认无误后可 `node scripts/migrate-main.mjs --drop-old`。
- `pnpm build`（已带 `--skip-indexing`，避免构建期索引依赖 bridge）；重启 `pnpm start`。
- 合并后的索引刷新由运维任务负责，需要把 `main` 命名空间更新到最新 `tina`。