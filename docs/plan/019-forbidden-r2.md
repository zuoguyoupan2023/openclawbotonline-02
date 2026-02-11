# 禁用 R2 存储与精简 Admin UI 方案

## 目标
- 禁用 R2 存储：不挂载、不恢复、不定时备份、不提供管理接口
- Admin UI 不显示任何 R2 相关内容（存储状态、同步/备份按钮、R2 文件列表）
- 移除 clawdbot.json / openclaw.json 配置编辑区域
- 保留：重启网关、设备配对列表、AI 管理标签页

## 范围
- 后端：R2 挂载、恢复、同步、R2 管理接口、R2 读配置回退、cron 备份
- 前端：AdminPage R2 相关 UI 与接口调用、配置编辑区域

## 方案概要

### 1. 后端彻底禁用 R2 存储
在 Worker 侧添加统一开关 `DISABLE_R2_STORAGE=true`，并在关键路径直接短路：
- `src/gateway/r2.ts`：检测到开关后直接返回 false，不尝试挂载
- `src/gateway/sync.ts`：`syncToR2` 与 `restoreFromR2` 在开关开启时直接返回禁用错误
- `src/routes/api.ts`：
  - `/api/admin/storage` 返回 404 或 `{ configured:false, message:"disabled" }`
  - `/api/admin/storage/sync`、`/api/admin/storage/restore` 直接返回 404/403
  - `/api/admin/r2/*` 接口直接返回 404/403
  - `readConfigFileWithR2Fallback` 在开关开启时跳过 R2 回退逻辑
- `src/index.ts`：cron `scheduled` 中检测到开关后直接 return，不触发备份
- `start-moltbot.sh`：在 R2 恢复段落前加入开关判断，直接跳过恢复逻辑

效果：R2 逻辑在服务端完全失效，容器仅使用本地易失存储。

### 2. Admin UI 移除 R2 与配置编辑区域
在 AdminPage 仅保留“重启网关、设备配对、AI 管理”内容：
- `src/client/pages/AdminPage.tsx`
  - 删除存储状态卡片与同步/备份按钮区块
  - 删除 R2 文件列表与上传、删除相关 UI 区块
  - 删除 clawdbot.json / openclaw.json 配置编辑区块
  - 保留：重启网关按钮、设备配对列表、AI 管理 tab
- `src/client/api.ts`
  - 移除 `getStorageStatus/triggerSync/triggerRestore`
  - 移除 `listR2Objects/getR2Object/deleteR2Object/deleteR2Prefix/uploadR2Object` 等 R2 API
- 本地化文案（可选清理）：
  - `src/client/locals/*.json` 删除 storage 与 r2 相关键值

效果：Admin UI 不再出现任何 R2、备份与配置编辑的入口。

## 已执行补充
- 注释部署期 R2 缺失凭据与重启后同步提示文案
- 清理前端 R2 与配置编辑相关的接口引用与本地状态

## 验证要点
- Admin UI 可正常加载，且只包含重启网关、配对、AI 管理内容
- 访问 `/api/admin/storage`、`/api/admin/storage/sync`、`/api/admin/storage/restore`、`/api/admin/r2/*` 均返回禁用状态
- cron 不再触发 R2 备份，容器重启不会进行 R2 恢复
