# 此个人实例的提交自动部署

此文件仅适用于所有者 `xiaohu65` 的公开仓库 `xiaohu65/FlareMo` 和既有实例 <https://flaremo-personal.yangxiaohu65.workers.dev>。

所有者已明确授权：向自己的 `main` 分支提交后，使用 GitHub Actions 自动部署到现有 Cloudflare 实例。此授权仅覆盖本次个人部署流程，优先于上游 `AGENTS.md` 中“永远不用 GitHub Actions 做生产部署器”的通用限制；上游规范原文保持不变。没有授权自动升级上游版本。更新工作流的定时触发已移除，仍可由所有者手动发起升级 PR。

## 配置边界

仓库 Actions Secrets 必须提供以下三项：

| 名称 | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 仅授权目标 Cloudflare 账户的部署、D1 迁移及既有资源读取/绑定所需权限；不授予域名或计费管理权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 既有个人实例所在账户 |
| `WRANGLER_JSONC` | 此实例完整的实际部署配置；必须使用既有 D1 ID、R2、Queues、Vectorize 名称与正式网址，不接受模板回退 |

`wrangler.jsonc` 已被 Git 忽略。不要提交它，也不要在 `WRANGLER_JSONC` 的 `vars` 中填写应用密钥。`BETTER_AUTH_SECRET` 继续保存在 Cloudflare Worker Secrets，CI 只读取密钥名称确认其存在，不读取、生成、同步或替换其值。不要向 GitHub 复制该认证密钥、管理员密码、Cookie、PAT、bootstrap 或 recovery 凭据。

生产目标固定为 Worker `flaremo-personal`，D1 `flaremo-personal-db`，R2 `flaremo-personal-attachments`，Queues `flaremo-personal-member-removal` / `flaremo-personal-data-export`，Vectorize `flaremo-personal-memos` / `flaremo-personal-memories`。AI 继续使用 Workers AI 的现有模型和 1024 维索引。修改这些身份、域名路由或关闭现有语义检索配置会被部署检查拒绝；迁移到其他实例需要单独审查配置及校验规则。

## 如何使用

1. 向本仓库 `main` 推送已审查的修改，或将自己的 PR 合并到 `main`，触发 **Deploy to Cloudflare**。其他分支、外部 PR 和上游仓库不发布生产实例。
2. 在 Actions 查看运行结果。流程先检查配置、格式、类型和部署脚本测试，再只读验证远端资源、认证密钥名称及已完成的管理员初始化状态，并执行构建和部署预演。
3. 正式发布仍运行官方 `pnpm deploy`：构建前端、应用未执行的 D1 migrations，然后发布 Worker。流程不创建资源，不重置账号，不同步应用密钥。后续检查要求首页 HTTP 200、初始化状态为 `complete`、公开注册关闭、未登录访问 `/api/v1/auth/me` 返回 401。
4. **Run workflow** 选择 `main` 并勾选 `dry_run`，可只执行检查和构建，跳过数据库迁移和发布。未勾选则重新部署所选 `main` 提交。

同一时间仅执行一个生产部署，不自动取消已经开始的部署。GitHub 的 concurrency 可能用较新的待执行运行替换旧的待执行运行，因此快速连续推送不保证每个中间提交单独发布；运行中的迁移和发布不会因新提交被自动取消。仓库原有 `ci.yml` 保留独立运行；部署工作流自身也有必要的前置检查，不依赖另一个工作流先完成。不执行全量 `pnpm verify` 或 E2E。

## 更新、故障与数据

此流程只发布自己的提交，不定时拉取上游。手动运行 **Prepare FlareMo update** 只准备升级 PR；必须审查版本变化、本地兼容修复和数据库迁移，合并到 `main` 后才会发布。更新部署校验或 workflow 本身时同样需要审查，不能借更新替换目标资源。

迁移先于 Worker 发布，必须兼容上一正式版本。数据库迁移成功后若发布失败，迁移不会自动撤销；先查明失败原因，再修复并重跑。不要直接回滚数据库或盲目重置实例。线上检查失败也可能发生在 Worker 已发布之后，失败状态不表示生产从未改变。

重要升级前先从应用导出数据，并按 [维护文档](maintenance.md) 保存必要的 D1 业务数据与 R2 附件备份；包含 FTS 的 D1 不能直接把整库 SQL dump 当作已验证备份方案。代码回退可以通过审查后的反向提交触发部署，但数据库和附件的恢复是独立操作。本流程不会创建备份、执行恢复演练、自动回滚或更新 Cloudflare 套餐。

Cloudflare 的额度和 R2 按量收费条件仍适用，提交自动部署不构成费用上限。GitHub Actions 的可用性与使用限额按该公开仓库当时的账户政策执行。

参考：[Cloudflare GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
