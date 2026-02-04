### 目的
在不破坏历史数据与 R2 备份结构的前提下，将容器内 CLI 从 clawdbot 切换到 openclaw，并规划彻底迁移路径命名的后续步骤。

### 当前已实现内容（已完成）
1. 安装与版本校验
   - Dockerfile 安装 openclaw 并校验版本。

2. 启动脚本兼容
   - start-moltbot.sh 优先使用 openclaw CLI，缺失则回退 clawdbot。
   - 建立 /root/.openclaw 与 /root/.openclaw-templates 软链接，指向旧目录 /root/.clawdbot 与 /root/.clawdbot-templates。
   - 将 /root/.openclaw/openclaw.json 链接到现有 /root/.clawdbot/clawdbot.json。

3. Worker 侧 CLI 调用兼容
   - api.ts 与 debug.ts 的 CLI 调用改为检测 openclaw 是否存在，缺失则回退 clawdbot。

4. 进程识别兼容
   - process.ts 的网关进程识别支持 openclaw 与 clawdbot 命令名。

5. 测试用例更新
   - process.test.ts 对 openclaw 命令名的断言已更新。

### 仍保留旧路径的原因
- 当前配置文件与持久化目录仍是 /root/.clawdbot 与 /data/moltbot，以兼容旧数据与 R2 备份结构。
- 通过软链接让新命名工具读取旧路径，避免迁移风险。

### 彻底迁移路径命名方案（仅规划，不执行）
目标：将 /root/.clawdbot 与 /data/moltbot 的命名全面迁移到 /root/.openclaw 与 /data/openclaw，且保证老数据可回滚。

#### A. 容器路径与配置文件
1. 启动脚本路径切换
   - CONFIG_DIR 改为 /root/.openclaw
   - TEMPLATE_DIR 改为 /root/.openclaw-templates
   - CONFIG_FILE 改为 /root/.openclaw/openclaw.json
2. 迁移策略
   - 启动时检测旧目录 /root/.clawdbot 是否存在，且新目录为空时，执行一次性迁移复制。
   - 迁移完成后可选保留旧目录为只读备份或软链接指向新目录。

#### B. R2 备份结构
1. 备份路径调整
   - 旧：${R2_MOUNT_PATH}/clawdbot/ 与 ${R2_MOUNT_PATH}/skills/
   - 新：${R2_MOUNT_PATH}/openclaw/ 与 ${R2_MOUNT_PATH}/skills/
2. 迁移策略
   - 同步脚本先检测旧备份目录是否存在，若存在且新目录为空，则复制一次。
   - 将 .last-sync 文件保持在根目录不变，以减少改动范围。

#### C. Worker 与调试接口
1. debug.ts
   - /debug/container-config 读取路径改为 /root/.openclaw/openclaw.json
2. api.ts / 其他路径展示
   - 若 UI 或 API 显示配置路径，需要同步更新为新路径。

#### D. 测试与验证
1. 更新测试断言
   - sync.test.ts 与 process.test.ts 中涉及路径的断言调整为 openclaw 目录。
2. 迁移验证步骤
   - 启动后检查新旧目录均可读取配置。
   - R2 同步后确认新目录结构生成且 .last-sync 正常更新。
   - 设备列表与审批 CLI 可正常工作。

#### E. 回滚方案
1. 仅在启动脚本中保留检测逻辑
   - 若 openclaw 路径异常，回退到 /root/.clawdbot 读取。
2. R2 回滚
   - 保留旧 clawdbot 目录至少一个发布周期，确保可回滚。
