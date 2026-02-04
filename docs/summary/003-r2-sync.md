### 概述
R2 备份机制用于在 Cloudflare Sandbox 容器重启或资源回收后，恢复 OpenClaw 的配置与技能数据。容器内部数据是易失的，R2 提供持久化。当容器再次启动时，启动脚本会从 R2 恢复最近一次备份的数据，保证对话历史与设备配对等状态延续。

### 挂载与路径
- 挂载路径：`/data/moltbot`
- 桶名默认：`openclawbotonline-data`（可通过 `R2_BUCKET_NAME` 环境变量覆盖）
- 恢复/备份涉及目录：
  - 配置目录：`/root/.clawdbot`（兼容旧命名，openclaw 通过软链接访问）
  - 技能目录：`/root/clawd/skills`
  - 工作区核心文件：`/root/clawd/`（排除 `.git/` 与 `skills/`）
  - 备份标记：`/data/moltbot/.last-sync`（ISO 时间戳）

### 启动时恢复流程
文件：`start-moltbot.sh`
1. 判断是否已有网关进程在运行（openclaw/clawdbot 均识别），若已运行则退出启动脚本。
2. 建立目录与软链接：
   - `/root/.openclaw` 指向 `/root/.clawdbot`
   - `/root/.openclaw-templates` 指向 `/root/.clawdbot-templates`
   - `/root/.openclaw/openclaw.json` 指向 `/root/.clawdbot/clawdbot.json`
3. 从 R2 恢复：
   - 若存在 `/data/moltbot/clawdbot/clawdbot.json` 或旧版 `/data/moltbot/clawdbot.json`，且备份时间新于本地，则将 R2 的配置复制到本地 `/root/.clawdbot/`。
   - 若存在 `/data/moltbot/skills/` 且备份时间新于本地，则复制到 `/root/clawd/skills/`。
   - 若存在 `/data/moltbot/workspace-core/` 且备份时间新于本地，则复制到 `/root/clawd/`（排除 `.git/` 与 `skills/`）。
4. 若本地配置不存在，则从模板初始化（`moltbot.json.template`）或创建最小配置。
5. 根据环境变量更新配置（网关、Telegram/Discord/Slack、AI 提供方等）。
6. 启动网关（优先 `openclaw` CLI，缺失时回退到 `clawdbot`）。

### 运行中备份流程
代码：`src/gateway/sync.ts`、`src/index.ts`（cron）
1. 检查 R2 凭据（`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`CF_ACCOUNT_ID`），缺失则返回“未配置”。
2. 挂载 R2 桶到 `/data/moltbot`：
   - `mountBucket(bucketName, R2_MOUNT_PATH, { endpoint, credentials })`
   - endpoint 形如：`https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com`
   - 桶名由 `getR2BucketName(env)` 决定（可通过 `R2_BUCKET_NAME` 覆盖）
3. 挂载检查：通过 `mount | grep s3fs on /data/moltbot` 校验是否已挂载。
4. 健壮性：若挂载抛错但检查显示已挂载，则视为成功（容错处理）。
5. 同步步骤：
   - 先校验源（本地）是否存在关键文件 `/root/.clawdbot/clawdbot.json`，否则拒绝备份，避免把空数据覆盖到 R2。
  - 使用 `rsync -r --no-times --delete` 将 `/root/.clawdbot/` 同步到 `/data/moltbot/clawdbot/`；将 `/root/clawd/skills/` 同步到 `/data/moltbot/skills/`；将 `/root/clawd/` 同步到 `/data/moltbot/workspace-core/` 并排除 `.git/` 与 `skills/`。
   - 写入 `/data/moltbot/.last-sync` 为 ISO 时间戳，作为成功标记。
6. 每 5 分钟触发一次定时备份（cron 调度），也可通过 Admin API 手动触发：
   - `POST /api/admin/storage/sync`

### 管理与状态查询
- `GET /api/admin/storage`：
  - 尝试挂载（如未挂载）
  - 读取 `/data/moltbot/.last-sync` 时间戳
  - 返回是否已配置、缺失的凭据列表、最近备份时间
- `POST /api/admin/storage/sync`：
  - 触发一次手动同步
  - 成功时返回 `lastSync` 时间戳
  - 失败时返回 `error` 与 `details`（含挂载错误信息）

### 关键设计点
- 采用“备份/恢复”模式而非实时双写：降低复杂性，适合容器化环境。
- 使用软链接兼容 openclaw 新命名与旧目录结构，避免一次性迁移风险。
- `rsync` 使用 `--no-times` 适配 s3fs 的时间戳行为，避免 I/O 错误。
- 在备份前做源完整性校验，防止用空或损坏数据覆盖 R2。
- 将“是否已挂载”的判断与挂载错误解耦，提升容错性。

### 常见问题与排查
1. “Failed to mount R2 storage”
   - 检查 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`CF_ACCOUNT_ID`
   - 检查 `R2_BUCKET_NAME` 是否与实际桶名一致（默认：`openclawbotonline-data`）
   - 查看 `/api/admin/storage/sync` 返回 `details` 获取确切错误
2. 手动备份返回 400 “not configured”
   - 缺少 R2 凭据，请补充所有所需 secrets
3. 备份成功但恢复失败
   - 确认 `.last-sync` 较新且备份路径结构正确（`clawdbot/` 与 `skills/`）
   - 确认容器启动后已挂载 R2（`mount | grep s3fs`）

### 未来改进（规划）
- 路径彻底迁移到 `openclaw` 命名（`/root/.openclaw`、`/data/openclaw`）并提供一次性迁移脚本。
- 备份策略可选差异化同步或版本化目录，支持回滚。
