### 目标
在不偏离官方 moltworker 的前提下，明确现有 R2 备份/同步机制与文件范围，解释 A/B 类操作偏高原因，并规划更合理的保存结构与更高频率、低操作数的同步方案。

### 现状调研结论（本项目）
#### 1. 同步与备份机制
- 触发入口：
  - 定时：wrangler cron 触发 `src/index.ts` 的 scheduled → `syncToR2`。
  - 手动：`POST /api/admin/storage/sync` → `syncToR2`。
- 挂载：`src/gateway/r2.ts` 使用 s3fs 挂载 R2 到 `/data/moltbot`。
- 备份：`src/gateway/sync.ts` 运行三次 rsync + 写入 `.last-sync`。
- 恢复：容器启动脚本 `start-moltbot.sh` 从 `/data/moltbot` 恢复配置、技能、workspace-core。

参考：
- 同步实现：[sync.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/gateway/sync.ts#L1-L190)
- 挂载逻辑：[r2.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/gateway/r2.ts#L1-L75)
- 启动恢复：[start-moltbot.sh](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/start-moltbot.sh#L1-L164)
- 定时触发：[index.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/index.ts#L418-L447)

#### 2. 备份内容与重复分析
当前备份路径结构（R2 前缀）：
- `clawdbot/` ← `/root/.clawdbot/`（配置）
- `skills/` ← `/root/clawd/skills/`
- `workspace-core/` ← `/root/clawd/`，排除 `.git/`、`skills/`、`node_modules/`、`config/ai-env.json`
- `.last-sync` ← 备份时间戳

是否重复：
- `workspace-core` 明确排除 `skills/`，因此不会重复保存技能目录。
- 配置目录与 workspace-core 逻辑上独立，没有路径重叠。
- 潜在冗余来自 workspace-core 的宽范围：`/root/clawd/` 下除排除项外的所有内容都会被备份，包含可能不需要持久化的文件。

#### 3. workspace-core 保存逻辑
恢复时机与条件：
- 当 R2 的 `.last-sync` 新于本地，或本地工作区为空，或缺失 `USER.md`/`SOUL.md`/`MEMORY.md` 时恢复。
- 恢复方式：`rsync -r --no-times --delete` 从 `workspace-core/` 覆盖到 `/root/clawd/`。

结论：
- workspace-core 是“兜底式全量工作区备份”，内容范围较宽，容易将不必要文件也纳入备份。
- 冗余风险主要在于“非必要文件”被同步，而不是同一文件在多个路径重复保存。

#### 4. R2 A/B 类操作数偏高原因
即使只有几百个对象，每次同步仍可能产生大量 A/B 操作，核心原因：
- `rsync --delete` 需要对源和目标做目录扫描与对比，s3fs 会频繁触发 LIST/HEAD/GET 等请求。
- 每次同步会执行 3 次 rsync（配置/skills/workspace-core），等价于 3 轮对象对比。
- s3fs 目录是“虚拟目录”，每次 `rsync` 的 stat/list 都会产生多次 R2 请求。
- 同步完成还会读取 `.last-sync` 验证，增加少量额外请求。

操作类型映射（概念层面）：
- B 类：LIST/HEAD/GET 为主（目录扫描、元数据检查、读取时间戳）。
- A 类：PUT/DELETE 为主（新增、变更、删除对象）。

### 与官方 moltworker 的差异
官方参考（已获取到 `/reference/moltworker`）：
- 备份结构：`openclaw/` + `workspace/` + `skills/`。
- 配置目录：优先 `/root/.openclaw`，兼容 `/root/.clawdbot`。
- workspace 目标更收敛，倾向于 `IDENTITY.md/USER.md/MEMORY.md/memory/assets`。

参考：
- 官方同步：[reference/moltworker/src/gateway/sync.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/reference/moltworker/src/gateway/sync.ts#L1-L101)
- 官方启动脚本：[reference/moltworker/start-openclaw.sh](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/reference/moltworker/start-openclaw.sh#L1-L150)

### 目标拆解
1. 保存结构更合理，且尽量对齐官方仓库。
2. 保存频率更高，但 A/B 操作计数更少。

### 分阶段实施方案
#### 阶段一（安全对齐）
- 备份前缀对齐到 `openclaw/` 与 `workspace/`，保留旧前缀读取兼容。
- 恢复流程支持新旧前缀自动选择与迁移。
- 管理端 R2 前缀列表同时展示新旧前缀用于验证。

#### 阶段二（范围收敛）
- workspace 从全量改为白名单目录同步。
- 仅保留必要文件与目录，减少对象数量与备份体积。

#### 阶段三（差异同步）
- 引入清单文件与差异计算，仅同步变更对象。
- 增加重启后清单一致性基线逻辑，避免首次同步噪声。

### 规划方案
#### A. 结构对齐（低偏离）
1. R2 前缀调整为官方结构：
   - `openclaw/`（配置）
   - `workspace/`（工作区核心）
   - `skills/`（技能）
2. 启动恢复逻辑兼容旧结构：
   - 先读 `openclaw/`，否则回退 `clawdbot/` 并迁移。
3. 配置路径升级：
   - 使用 `/root/.openclaw` 作为主配置目录，保留 `.clawdbot` 兼容。

#### B. workspace 范围收敛（降低对象数）
1. 从“全量 `/root/clawd`”切换为“白名单目录”：
   - `IDENTITY.md`
   - `USER.md`
   - `SOUL.md`
   - `MEMORY.md`
   - `memory/`
   - `assets/`
2. 明确排除：
   - `node_modules/`、`logs/`、`cache/`、`.git/`、`skills/`
3. 同步策略从“全量 rsync”改为“白名单 rsync”或“白名单打包”。

#### C. 降低 A/B 操作数 + 提升频率
方案 1（保持 s3fs/rsync，改为变更检测）：
- 在本地维护 `workspace` 与 `config` 的 hash 快照（如 `sha256`），写入 `/root/.openclaw/.last-sync-hash`。
- 同步前先计算 hash，若无变化则跳过 rsync，减少 LIST/HEAD 触发。
- 频率可提高到 2–5 分钟，但多数周期将“快速跳过”。

方案 2（降低 R2 对象数量，减少 LIST/HEAD）：
- 将 workspace 打包成单一对象（如 `workspace.tar`），只在变更时上传。
- 优点：单次同步对象数极少，A/B 操作显著下降。
- 风险：恢复时需解包；大文件变更会导致整包重传。

方案 3（混合）：
- 配置与技能保持文件级同步（变更相对少）。
- workspace 使用白名单 + 变更检测或打包同步。

### 推荐路径（折中）
1. 对齐官方目录与前缀结构（最小偏离）。
2. workspace 改白名单 + 变更检测（避免大包重传）。
3. 提升 cron 频率，但加入“变更短路”，保证 A/B 操作显著减少。

#### D. 容器重启后的清单一致性设计
目标：容器初始化后先“以 R2 为准完成恢复”，再建立本地清单，使首次备份不触发大量变更与覆盖。

流程建议：
1. 启动恢复完成后，在本地生成清单并记录为“恢复基线”：
   - 从已恢复到容器的文件生成 `local manifest`。
   - 同步保存为 `/root/.openclaw/.sync-manifest.json`。
2. 如果 R2 上存在 `manifest.json`：
   - 使用 R2 清单覆盖本地清单，作为基线。
   - 若缺失 R2 清单但有 `.last-sync`，则以本地清单生成并写回 R2。
3. 首次定时同步时执行“基线一致性校验”：
   - 如果本地清单与 R2 清单一致，跳过对象级同步，仅更新时间戳或跳过。
   - 如果不一致，仅对差异文件做最小上传/删除，随后更新 R2 清单。

关键点：
- 恢复流程完成之前禁止启动备份，避免“空数据覆盖”。
- 使用“恢复标记文件”或状态位（例如 `.restored-from-r2`）作为备份前置条件。
- 清单对比优先使用 size/mtime；必要时对疑似变更做 hash 校验。

### 实施步骤（建议顺序）
1. 迁移 R2 前缀到 `openclaw/` 与 `workspace/`，保留旧前缀兼容读取。
2. 引入 workspace 白名单同步，删除 `workspace-core` 全量逻辑。
3. 增加变更检测（hash 或时间戳差异）作为同步短路。
4. 调整 cron 频率（如 2–5 分钟），验证操作数下降。

### 风险与回滚
- 风险：白名单遗漏导致关键文件未备份。
  - 回滚：保留旧 `workspace-core` 恢复逻辑一个周期。
- 风险：hash 计算性能开销。
  - 回滚：只对少量文件做 hash 或改为 mtimes/size 比对。

### 验证指标
- 单次同步产生的 R2 操作数（A/B）与对象数变化。
- 同步后恢复是否完整（配置、skills、workspace 关键文件）。
- 对比旧结构与新结构的恢复耗时与稳定性。
