### 概述
本摘要整理当前项目的 Admin 管理界面的两大核心逻辑：登录机制与 AI 设置。内容包含接口、数据流、前端交互与服务端校验，并给出源码定位以便快速追踪。

### 登录机制
- 外层门禁：统一使用 Cloudflare Access 验证 JWT，未携带或无效时直接拒绝或引导登录。参考 [middleware.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/auth/middleware.ts#L120-L195)
- 内层会话：可选的“应用内登录”叠加校验，启用条件为设置环境变量 ADMIN_USERNAME 与 ADMIN_PASSWORD。参考 [middleware.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/auth/middleware.ts#L42-L48)
- 会话令牌：
  - 格式：payload.signature，签名为 HMAC-SHA256(ADMIN_PASSWORD)，TTL 默认 8 小时
  - 生成与校验：参考 [createAdminSessionToken](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/auth/middleware.ts#L88-L94) 与 [verifyAdminSessionToken](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/auth/middleware.ts#L95-L107)
  - Cookie 名称：admin_session，HttpOnly + SameSite=Strict。参考 [public.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/public.ts#L87-L96)
- 接口设计：
  - GET /api/auth/status：返回 enabled + authenticated 状态。参考 [public.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/public.ts#L65-L75)
  - POST /api/auth/login：校验用户名/密码，成功后写入 admin_session。参考 [public.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/public.ts#L77-L97)
  - POST /api/auth/logout：清除 admin_session。参考 [public.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/public.ts#L99-L103)
- 管理 API 保护：
  - 先应用 CF Access 中间件，再按需校验 admin_session。参考 [api.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L107-L122)
  - 路由挂载与中间件装配位于主入口。参考 [index.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/index.ts#L192-L201)
- 前端交互：
  - 状态检测：getAdminAuthStatus 判断是否启用内层登录与当前是否已认证。参考 [client/api.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/client/api.ts#L229-L244)
  - 登录流程：loginAdmin 提交用户名/密码，成功后刷新设备、存储与 AI 配置。参考 [AdminPage.tsx](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/client/pages/AdminPage.tsx#L448-L473)

### AI 设置（Admin）
- 目标：在 Admin 界面管理多家 Provider 的 Base URL、API Key 与主用 Provider，并与容器网关的环境变量注入打通。设计背景见 [010-ai-provider-choose.md](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/docs/summary/010-ai-provider-choose.md)
- 配置存储：
  - 位置：R2 对象 workspace-core/config/ai-env.json
  - 结构：baseUrls、apiKeys 均支持覆盖或清空；primaryProvider 可为 'anthropic' | 'openai' | 'deepseek' 或 null（auto）。参考 [api.ts:AI_ENV_CONFIG_KEY 定义与读写](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L24-L33) [读写函数](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L48-L65)
- 管理接口：
  - GET /api/admin/ai/config：返回合成视图，将 R2 覆盖值与当前环境变量融合，标注来源 saved/env/cleared。参考 [api.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L487-L491) 与 [buildAiEnvResponse](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L67-L92)
  - POST /api/admin/ai/config：提交增量更新（空串/空值表示清空），写回 R2 并返回最新合成视图。参考 [api.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L493-L535)
  - 诊断：支持获取网关日志与重启网关以应用新配置。参考 [gateway/logs](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L537-L556) 与 [gateway/restart](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L558-L594)
- 环境注入与路由通道：
  - 注入策略：根据是否使用 AI Gateway，以及 Gateway 是否为 /openai 入口，动态映射 OPENAI_BASE_URL/OPENAI_API_KEY 或 ANTHROPIC_BASE_URL/ANTHROPIC_API_KEY。参考 [env.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/gateway/env.ts#L34-L64)
  - 主/兼容模型：OpenAI 通道使用 responses；Anthropic 通道使用 messages；DeepSeek 通过 OpenAI 兼容通道接入，具体选择见前述摘要文档
- 前端界面（Admin → AI 基础设置）：
  - 主 Provider 选择：auto/anthropic/openai/deepseek 四档，变更会写入 primaryProvider。参考 [AdminPage.tsx](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/client/pages/AdminPage.tsx#L1352-L1408)
  - Base URL 编辑：逐键编辑、确认、清空；保存时仅提交变更键。参考 [AdminPage.tsx](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/client/pages/AdminPage.tsx#L1416-L1487)
  - API Key 编辑：默认掩码展示，进入编辑后可录入或清空；保存时仅提交变更键。参考 [AdminPage.tsx](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/client/pages/AdminPage.tsx#L1499-L1576)
  - 保存与回填：合成更新 payload，调用 saveAiEnvConfig 后以返回值回填本地草稿与脏标记。参考 [AdminPage.tsx](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/client/pages/AdminPage.tsx#L379-L421)；接口定义见 [client/api.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/client/api.ts#L154-L162)
  - AI 配置加载与日志诊断：进入 AI 页面时加载合成配置，可拉取网关日志查看容器内实际输出。参考 [AdminPage.tsx](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/client/pages/AdminPage.tsx#L320-L348) 与 [日志交互](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/client/pages/AdminPage.tsx#L350-L369)

### 备份与持久化（R2）
- 目标：容器重启后恢复配置、技能与工作区数据，避免临时容器丢失
- 状态查询：GET /api/admin/storage 返回是否配置、缺失凭据与最近备份时间。参考 [api.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L276-L334)
- 手动触发：POST /api/admin/storage/sync 触发一次同步并更新 .last-sync。参考 [api.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/routes/api.ts#L336-L373) 与 [sync.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/gateway/sync.ts#L1-L158)
- 定时同步：cron 入口调用 syncToR2 完成备份。参考 [index.ts](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/src/index.ts#L418-L441)
- 同步细节：恢复/覆盖策略、源完整性校验、rsync 规则见 [003-r2-sync.md](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/docs/summary/003-r2-sync.md)

### 使用流程
- 部署后，确保 CF_ACCESS_TEAM_DOMAIN 与 CF_ACCESS_AUD 已配置；必要时启用内层登录 ADMIN_USERNAME/ADMIN_PASSWORD
- 通过 Admin UI：
  - 如启用内层登录，先登录；否则直接进入管理页
  - 在 AI 页面选择主 Provider，按需填写 Base URL 与 Key；确认保存
  - 如需即时生效，可执行“重启网关”，或等待容器重启后按注入策略应用

### 关联参考
- 登录方案与对比说明： [007-admin-login.md](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/docs/plan/007-admin-login.md)
- AI 管理设计草案： [008-ai-management.md](file:///Users/burenweiye/Documents/GitHub/openclawbotonline-02/docs/plan/008-ai-management.md)
