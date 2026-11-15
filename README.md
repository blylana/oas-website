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

## 内容结构

- `src/content/docs/user-manual/`：用户手册
- `src/content/docs/development/`：开发文档
- `public/images/`、`public/picture/`：从旧站迁移的图片资源
- `packages/starlight-theme-six/src/overrides/Header.astro`：Six 主题 Header，包含站点导航和主题操作
- `packages/starlight-theme-six/src/overrides/Sidebar.astro`：Six 主题 Sidebar，按文档区域过滤目录

站点配置位于 `astro.config.mjs`，文档侧栏和导航入口都在这里维护。
