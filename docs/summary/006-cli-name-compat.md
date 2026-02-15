## 006 版本名称兼容性说明

### 目标
在不破坏历史数据与现有部署的前提下，兼容不同 CLI 名称的版本变更，保证运行时功能一致。

### 兼容范围
- 新包命令：openclawbot-online
- 上游命令：openclaw
- 旧命令：clawdbot

### 兼容策略
- 运行时优先级：openclawbot-online → openclaw → clawdbot
- 所有调用 CLI 的位置统一复用同一检测逻辑，避免不同模块选择不一致

### 覆盖位置
- 容器启动脚本：负责 gateway 启动与 CLI 选择
- Worker 后端 API：设备列表、配对审批、更新等命令
- Debug 接口：版本与 CLI 调试命令
- 进程识别：识别 gateway 进程与排除 CLI 子命令

### 不做的改动
- 不迁移路径与目录命名（如 /root/.clawdbot 与 /data/moltbot）
- 不改变现有 R2 备份结构

### 风险与回滚
- 若新 CLI 不可用，自动回退到旧命令
- 兼容逻辑不依赖额外配置，回滚只需恢复到旧版本代码
