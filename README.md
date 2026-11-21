# OnmyojiAutoScript 文档站

这是 OnmyojiAutoScript 的中文文档站，使用 Starlight 构建，包含用户手册和开发文档。

## 本地开发

```bash
pnpm install
pnpm dev
```

开发服务器默认运行在 `http://localhost:4321/`。构建生产版本： 

```bash
pnpm build
pnpm preview
```

## 本地部署

编译 -> 启动数据库 -> 启动后端 ->启动前端
```bash
$env:TINA_PUBLIC_IS_LOCAL="false"
pnpm install --frozen-lockfile
pnpm build
```

```bash
# 开启
Start-Service MongoDB
# 关闭
Stop-Service MongoDB
# 查看状态
Get-Service MongoDB
```

```bash
$env:TINA_PUBLIC_IS_LOCAL="false"
$env:PORT="4322"
pnpm start
```

后端日志以 JSON 输出到标准输出，默认级别为 `info`。可通过 `LOG_LEVEL=debug|info|warn|error|fatal` 调整级别；每个请求都会返回 `x-request-id`，便于和服务端日志关联。

部署已发布文档时，在对应 Git 版本上完成构建后刷新 Tina 的编辑基准：

```bash
pnpm exec tsx scripts/reindex-main.ts <published-commit>
```

命令先构建和检查新的 MongoDB 索引，随后切换编辑基准。已有草稿保留原来的基准。

新版 Tina 草稿使用 `oas-draft-*` 分支。若旧草稿使用 GitHub 登录名作为分支名，可以先完成已有 PR，或在 GitHub 保留原有改动后通过 Clean 开始新草稿。Clean 会保留这些旧分支和已在 Tina 外修改的分支。

```bash
caddy run --config .\Caddyfile
```


## 内容结构

- `src/content/docs/user-manual/`：用户手册
- `src/content/docs/development/`：开发文档
- `public/images/`、`public/picture/`：从旧站迁移的图片资源
- `packages/starlight-theme-six/src/overrides/Header.astro`：Six 主题 Header，包含站点导航和主题操作
- `packages/starlight-theme-six/src/overrides/Sidebar.astro`：Six 主题 Sidebar，按文档区域过滤目录

站点配置位于 `astro.config.mjs`，文档侧栏和导航入口都在这里维护。
