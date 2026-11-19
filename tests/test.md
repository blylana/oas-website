# OnmyojiAutoScript Website 测试清单

本清单覆盖后端、数据隔离、GitHub 提交链路、审校接口和 Tina 管理后台。每项测试记录执行结果和证据，状态使用 `TODO`、`PASS`、`FAIL` 或 `BLOCKED`。

## A. 不需要真实浏览器的测试

### A1. 构建与依赖

- [x] A1.1 `pnpm install --offline --frozen-lockfile` 能应用 Tina patch，结果：`PASS`
- [x] A1.2 `pnpm run build` 成功生成 Tina 管理页面和 Astro 服务端资源，结果：`PASS`
- [x] A1.3 `pnpm-lock.yaml` 中的 patched dependency 与 `patches/tinacms@3.15.2.patch` 一致，结果：`PASS`
- [ ] A1.4 TypeScript 全量检查，结果：`FAIL`（`pnpm exec tsc --noEmit` 受现有 Astro/Starlight 依赖类型不兼容影响，生产构建仍通过）

### A2. 静态页面与服务启动

- [x] A2.1 服务端启动后 `/` 返回 200，结果：`PASS`
- [x] A2.2 `/admin/index.html` 返回 Tina 管理页面，结果：`PASS`
- [x] A2.3 `/development/log/` 返回文档页面，结果：`PASS`
- [x] A2.4 `/tina-island/docs` 和 `/tina-island/docsTitle` 正常响应，结果：`PASS`
- [x] A2.5 用户请求带 `x-request-id` 时响应回传相同的合法 request ID，结果：`PASS`
- [x] A2.6 非法或过长 request ID 被替换为服务端生成的 UUID，结果：`PASS`

### A3. 认证与权限

- [x] A3.1 未登录访问 `GET /api/tina/workspace` 返回 401，结果：`PASS`
- [x] A3.2 未登录访问 `POST /api/tina/submit` 返回 401，结果：`PASS`
- [x] A3.3 未登录访问 `POST /api/tina/discard` 返回 401，结果：`PASS`
- [ ] A3.4 无 GitHub 身份时保存返回可识别的 `github_reauth` 错误，结果：`TODO`
- [ ] A3.5 Clerk 鉴权成功后请求上下文包含 user ID 和 GitHub login，结果：`TODO`
- [ ] A3.6 GitHub token 失效时清理缓存身份并返回可重试错误，结果：`TODO`
- [x] A3.7 日志中不输出 Clerk token、GitHub token、Cookie 或 Authorization 内容，结果：`PASS`

### A4. GraphQL 与草稿数据隔离

- [x] A4.1 GraphQL introspection/query 请求走普通读取路径，结果：`PASS`
- [x] A4.2 以 `#graphql` 开头的 mutation 被识别为写入请求，结果：`PASS`
- [ ] A4.3 首次写入会从 `main` namespace 克隆用户 draft，结果：`TODO`
- [ ] A4.4 同一用户后续读取使用 `draft:<userId>` namespace，结果：`TODO`
- [ ] A4.5 两个用户的 draft 数据互相不可见，结果：`TODO`
- [ ] A4.6 draft 删除后用户回到 main 内容，结果：`TODO`
- [ ] A4.7 GraphQL 写入失败时清空 buffer，不产生 GitHub commit，结果：`TODO`

### A5. GitProvider 与 GitHub commit

- [x] A5.1 `onPut` 将文件写入操作加入 buffer，结果：`PASS`
- [x] A5.2 `onDelete` 将删除操作加入 buffer，结果：`PASS`
- [x] A5.3 同一文件多次修改只提交最后一次内容，结果：`PASS`
- [x] A5.4 首次保存能确保用户 fork 和用户分支存在，结果：`PASS`
- [x] A5.5 tree/blob/commit/ref API 按正确顺序调用，结果：`PASS`
- [x] A5.6 删除文件使用 Git tree 的删除表示，结果：`PASS`
- [x] A5.7 ref 冲突时重新读取 head 并重试，结果：`PASS`
- [x] A5.8 GitHub 暂时失败时保存 draft，并记录 pending commit，结果：`PASS`
- [x] A5.9 下次保存或 sweep 能重试 pending commit，结果：`PASS`
- [x] A5.10 成功 commit 后 workspace 更新 head SHA、changed paths 和 pending 状态，结果：`PASS`

### A6. Workspace、锁和限流

- [x] A6.1 workspace 创建、读取、更新和删除正常，结果：`PASS`
- [ ] A6.2 workspace login 变化时清理旧 fork、旧分支和旧 draft，结果：`TODO`
- [ ] A6.3 workspace 空闲过期时保存前触发清理，结果：`TODO`
- [x] A6.4 同一用户并发保存只有一个请求持有锁，结果：`PASS`
- [x] A6.5 锁过期后可以被后续请求接管，结果：`PASS`
- [x] A6.6 保存限流达到阈值后返回 429，结果：`PASS`
- [x] A6.7 PR 操作限流达到阈值后返回 429，结果：`PASS`

### A7. PR、清理和定时 sweep

- [ ] A7.1 `POST /api/tina/submit` 没有变更时返回 no changes，结果：`TODO`
- [ ] A7.2 `POST /api/tina/submit` 能创建 PR 并保存 PR 编号和 URL，结果：`TODO`
- [ ] A7.3 已有 PR 时重复 submit 保持幂等，结果：`TODO`
- [ ] A7.4 PR 状态为 open 时同步为 submitted，结果：`TODO`
- [x] A7.5 PR 状态为 merged 时清理 workspace、draft 和分支，结果：`PASS`
- [x] A7.6 PR 状态为 closed 时清理 workspace、draft 和分支，结果：`PASS`
- [x] A7.7 `POST /api/tina/discard` 关闭 PR、删除分支、删除 draft 并删除 workspace，结果：`PASS`
- [x] A7.8 discard 重复调用保持幂等，结果：`PASS`
- [ ] A7.9 sweep 能重试 pending commit，结果：`TODO`
- [ ] A7.10 sweep 能处理 merged/closed PR，结果：`TODO`
- [ ] A7.11 sweep 能清理七天未活动且没有开放 PR 的 workspace，结果：`TODO`

### A8. 日志和错误处理

- [x] A8.1 请求完成日志包含 method、path、status、request ID 和 duration，结果：`PASS`
- [x] A8.2 GitHub 请求失败日志包含状态和操作上下文，结果：`PASS`
- [ ] A8.3 未处理异常返回统一 500 JSON，结果：`TODO`
- [ ] A8.4 unhandled rejection 和 uncaught exception 被记录，结果：`TODO`
- [x] A8.5 保存失败不会把半成品 commit 标记为成功，结果：`PASS`

## B. 需要真实浏览器的测试

这些测试必须在已登录的 Tina 管理后台完成，使用真实页面点击和浏览器 Network/Console 观察结果。

### B1. 编辑器底部布局

- [x] B1.1 编辑器底部从左到右显示 `Reset`、`Save`、`Pr`、`Clean`、状态，结果：`PASS`
- [x] B1.2 四个按钮使用紧凑尺寸，状态区域保持原有内容，结果：`PASS`
- [x] B1.3 底部按钮左对齐，窄屏不溢出，结果：`PASS`
- [x] B1.4 Reset、Save、Pr、Clean 的 tooltip 或辅助文本仍表达原始语义，结果：`PASS`

### B2. Tina 编辑操作

- [x] B2.1 修改字段后显示 Unsaved changes，结果：`PASS`
- [x] B2.2 点击 Reset 弹出确认框，确认后恢复原值并清除 dirty 状态，结果：`PASS`
- [x] B2.3 点击 Reset 取消后保留修改，结果：`PASS`
- [x] B2.4 修改字段后点击 Save，Network 出现带 `#graphql` 的 update mutation，结果：`PASS`
- [x] B2.5 Save 成功后页面显示无未保存修改，结果：`PASS`
- [ ] B2.6 Save 失败时页面显示错误且不误报成功，结果：`TODO`

### B3. PR 和 Clean 操作

- [x] B3.1 点击 Pr 会先保存 dirty 表单，再调用 `/api/tina/submit`，结果：`PASS`
- [x] B3.2 Pr 成功后状态显示 PR 编号或审核状态，结果：`PASS`
- [ ] B3.3 重复点击 Pr 不创建重复 PR，结果：`TODO`
- [x] B3.4 点击 Clean 弹出放弃修改确认框，结果：`PASS`
- [x] B3.5 Clean 取消后保留当前修改，结果：`PASS`
- [x] B3.6 Clean 确认后刷新页面并恢复 main 内容，结果：`PASS`
- [x] B3.7 Clean 确认后用户分支、draft 和 workspace 被清理，结果：`PASS`

### B4. 状态、鉴权和隔离

- [x] B4.1 状态轮询能反映 workspace 状态变化，结果：`PASS`
- [x] B4.2 有 PR URL 时状态文字可以打开 PR，结果：`PASS`
- [ ] B4.3 GitHub 授权失效时显示重新授权入口，结果：`TODO`
- [x] B4.4 刷新页面后仍能看到当前用户 draft，结果：`PASS`
- [ ] B4.5 另一浏览器上下文登录另一用户时看不到前一个用户 draft，结果：`TODO`
- [x] B4.6 PR merged/closed 后刷新页面显示清理后的状态，结果：`PASS`

### B5. 浏览器异常场景

- [ ] B5.1 模拟 GraphQL 失败时界面显示保存错误，结果：`TODO`
- [ ] B5.2 模拟 GitHub 502/超时后界面显示可重试状态，结果：`TODO`
- [ ] B5.3 断网后恢复连接，页面可以重新加载 workspace，结果：`TODO`
- [ ] B5.4 窄屏视口下底部按钮仍可点击且状态不遮挡按钮，结果：`TODO`

## 执行记录

后端测试使用唯一 UUID、真实本地 MongoDB 和 mock GitHub API，测试结束后自动清理测试数据。真实浏览器测试使用已登录 Tina 页面。Save 测试产生的临时提交已回退到上游基线，并通过 Clean 删除用户测试分支，远端分支当前不存在，临时 PR #1 已关闭。全量 `tsc --noEmit` 仍有仓库既有 Astro/Starlight 类型错误，未影响生产构建。

| 日期 | 范围 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-20 | 底部编辑器布局 B1.1–B1.4 | PASS | Chrome DevTools page 3，顺序、尺寸、左对齐和辅助语义已核对 |
| 2026-11-20 | 后端模拟测试 | PASS | `pnpm exec tsx --test tests/backend.test.ts`，7/7 passed |
| 2026-11-20 | 静态页、服务端口、匿名认证 | PASS | 4321/4322/27017 监听，页面 200，匿名 Tina API 401 |
| 2026-11-20 | Reset / Save / Clean 浏览器流程 | PASS | Reset 确认恢复，Save commit 成功，Clean 确认后 workspace 和分支清理 |
| 2026-11-20 | Pr 提交审核与 Clean 回收 | PASS | 创建临时 PR #1，状态为 submitted，状态链接显示后用 Clean 关闭 PR、删除分支和 workspace |
