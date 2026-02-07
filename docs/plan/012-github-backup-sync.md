### 目标
提供一种基于私有 GitHub 仓库的备份/恢复方案，通过 commit 形成版本链，支持恢复最新版本或指定提交版本，避免单文件覆盖导致的不可追溯。

### 背景与问题
- R2 具备持久化与低延迟优势，但版本区分能力弱，且超出免费额度后持续付费。
- 现有备份路径以覆盖式写入为主，难以还原某一次具体备份状态。
- 希望通过 Git 的历史记录解决“版本区分与回溯”问题。

### 现有备份基线（R2）
- 备份范围：`/root/.clawdbot`、`/root/clawd/skills`、`/root/clawd`（排除 `.git/` 与 `skills/`、`node_modules/`）
- 触发方式：定时任务 + 管理端手动触发
- 成功标记：`.last-sync` 时间戳
- 恢复方式：重启后或手动恢复，将 R2 内容覆盖回容器

### 可行性评估
结论：可行，但仅适合“体积可控、变更频率较低”的备份内容。对大体积或高频写入不适合。

优点：
- 版本可追踪：每次备份都是一个 commit，天然形成时间序列。
- 可回滚：可恢复到任意 commit。
- 成本可控：小体积内容可接近 0 成本。

限制与风险：
- GitHub 单文件 100MB 限制，仓库总体大小与历史增长受限。
- 提交二进制大文件会急速膨胀历史体积，影响拉取与恢复速度。
- API 速率限制与网络波动会导致备份/恢复失败，需要重试与降级策略。
- 需要维护长期有效的 GitHub Token，权限与泄露风险必须严格控制。

### 适用范围与边界
适合：
- 配置文件（clawdbot.json/openclaw.json）
- skills 目录与少量脚本
- 小体积工作区配置（不含缓存、日志、依赖）

不适合：
- node_modules、日志、缓存、模型文件
- 频繁变更的长文本或大文件集合

### 方案设计概要
#### 备份内容结构
- `clawdbot/`：配置文件
- `skills/`：技能目录
- `workspace-core/`：工作区核心（严格排除 `.git/`、`node_modules/`、`logs/`、`cache/` 等）
- `manifest.json`：本次备份的元数据（时间戳、版本号、触发来源、包含项）

#### 备份流程（容器 -> GitHub）
1. 生成临时备份目录并按白名单拷贝内容。
2. 写入 `manifest.json`。
3. 生成 commit（推荐通过 GitHub API 创建 tree/commit，避免依赖 git CLI）。
4. 推送到指定分支（如 `backup/main` 或 `backup/history`）。
5. 返回 commit SHA 与时间戳作为备份标记。

#### 恢复流程（GitHub -> 容器）
1. 读取目标 commit（默认使用分支 HEAD，或指定 SHA）。
2. 将对应 tree 内容拉取到容器临时目录。
3. 执行恢复覆盖并写入恢复标记（如 `.restored-from-github`）。
4. 返回恢复结果与对应 commit SHA。

### API 规划（Worker）
- `GET /api/admin/storage/providers`
  - 返回可用存储类型与当前选中项
- `GET /api/admin/storage/github/commits?limit=<n>`
  - 返回最近 commit 列表（时间、SHA、摘要）
- `POST /api/admin/storage/github/backup`
  - 执行一次备份，返回 commit SHA
- `POST /api/admin/storage/github/restore`
  - body 可选 `commitSha`，为空则恢复最新版本

### UI 规划（Admin）
- 存储类型选择：R2 / GitHub
- GitHub 备份列表：显示最近 N 次 commit
- 同步/备份按钮：
  - 同步按钮：从 GitHub 恢复到容器
  - 备份按钮：将当前容器状态提交到 GitHub
- 恢复提示：显示恢复的 commit SHA 与时间

### 安全与权限
- 新增环境变量：
  - `GITHUB_BACKUP_REPO`（owner/repo）
  - `GITHUB_BACKUP_BRANCH`（默认 `backup/main`）
  - `GITHUB_BACKUP_TOKEN`（最小权限：仅该私有仓库的 contents 写入权限）
- Token 仅以 Secret 方式注入，不落盘、不回传前端。
- 可选：对备份内容做压缩与加密（如 age），降低泄露风险。

### 运行成本与限制
- GitHub API 限流：需要重试与指数退避。
- 历史膨胀：建议保留最近 N 次备份或按周合并一次快照。
- 大文件限制：若需要存放大文件，必须规划 LFS 或改回 R2。

### 与现有 R2 的关系
建议采用“分层存储”策略：
- GitHub：只存小体积、强版本化需求的数据（配置/技能/小型脚本）。
- R2：保留大体积或高频写入内容（日志、缓存、模型、对话历史等）。

### 验证计划
- PoC：只备份 clawdbot.json + skills/，验证 commit 列表与恢复。
- 性能：测量备份与恢复耗时，以及失败重试率。
- 回滚：至少验证恢复到最近 3 次提交的正确性。

### 结论
GitHub 备份可行，但应聚焦小体积版本化内容，并保留 R2 作为大文件与高频数据的主存储。若按此边界实施，可有效解决“版本区分”问题并控制成本。
