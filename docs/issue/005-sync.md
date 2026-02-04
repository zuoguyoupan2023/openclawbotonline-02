### 问题
管理界面显示“R2 storage is configured. Your data will persist across container restarts.”但“最近备份”长时间不更新（例如 15 分钟以上），怀疑自动同步未触发。

### 现象
- 管理界面“最近备份”时间不变
- R2 配置已完成，状态显示正常

### 分析
- “最近备份”时间来自 R2 根目录 `.last-sync`，只有同步成功写入该文件才会更新
- 自动同步依赖 Worker 的 cron 触发，`wrangler.jsonc` 的 `crons` 修改后必须重新部署才能生效
- 同步失败不会在管理界面直接显示错误信息，需要看后台日志或手动触发同步接口返回错误详情

### 解决方案
1. 修改 cron 频率后重新部署 Worker，确保触发器生效
2. 先手动触发同步验证链路是否正常：
   - 管理界面 `/_admin/` 点击“立即备份”
   - 或调用 `POST /api/admin/storage/sync`
3. 若手动同步失败，查看 `wrangler tail` 日志，定位具体错误（如挂载失败、凭据缺失等）

### 相关代码
- cron 触发：`wrangler.jsonc`
- 定时任务入口：`src/index.ts` 的 `scheduled`
- 同步逻辑与 `.last-sync`：`src/gateway/sync.ts`
- 管理界面“最近备份”展示：`src/routes/api.ts` + `src/client/pages/AdminPage.tsx`
