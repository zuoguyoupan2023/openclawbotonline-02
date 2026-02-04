### 目标
在 Admin UI 内提供 R2 存储桶管理能力，支持对象列表、上传、删除等操作，避免依赖本地工具。该功能只做桶内特定路径的安全管理，防止误删关键数据。

### 范围
- 仅管理固定前缀路径的对象
- 仅面向已通过 Cloudflare Access 认证的管理用户
- 只提供基础管理能力：列表、上传、删除、批量删除（按前缀）

### 设计概要
1. Worker 端新增 R2 管理 API
   - 列表：按前缀分页返回对象
   - 删除：删除单个对象或按前缀批量删除
   - 上传：小文件直传，大文件分片或限制大小
2. Admin UI 新增管理面板
   - 前缀选择器 + 对象列表
   - 上传控件（显示大小限制）
   - 删除操作（含二次确认）

### API 规划（Worker）
- `GET /api/admin/r2/list?prefix=<path>&cursor=<cursor>&limit=<n>`
  - 返回：objects、nextCursor、prefix
- `DELETE /api/admin/r2/object?key=<objectKey>`
  - 返回：success
- `DELETE /api/admin/r2/prefix?prefix=<path>`
  - 返回：deletedCount（可选）
- `POST /api/admin/r2/upload`
  - 表单或直传，返回 objectKey

### 权限与安全（必须）
- 必须通过 Cloudflare Access 认证
- 服务端强制白名单前缀校验，拒绝任何非白名单路径

白名单前缀（仅允许以下路径）：
- `clawdbot/`
- `skills/`
- `workspace-core/`
- `workspace-core/scripts/`
- `workspace-core/config/`
- `workspace-core/logs/`
- `workspace-core/memory/`

明确禁止的路径示例（全部拒绝）：
- `../` 或任何路径穿越
- 空前缀（禁止全桶）
- 非白名单前缀（如 `tmp/`、`backup/` 等）

### 关键实现点
- 列表分页：R2 list 支持 cursor，前端做分页加载
- 删除保护：删除/批量删除必须二次确认
- 上传限制：限制大小与数量，避免 Worker 超时或内存压力
- 影响提示：标注删除会影响备份/恢复结果
- 目录语义：R2/S3 无真实目录，`xxx/` 只是 0B 占位对象，删除该对象不会自动删除子对象
- 目录删除策略：当 key 以 `/` 结尾时，前端触发前缀删除（delete prefix），确保一并清理子对象

### UI 结构建议
- 左侧：前缀选择与搜索
- 右侧：对象列表（key、大小、最后修改时间、操作）
- 工具栏：上传、批量删除、刷新

### 风险与应对
- 误删：强制白名单 + 二次确认 + 操作日志
- 大量对象：分页 + 限制批量删除单次数量
- 权限漏洞：服务端强制校验，不依赖前端
