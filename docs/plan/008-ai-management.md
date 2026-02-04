### 目标
在 Admin 界面实现多 AI Provider 管理与默认模型选择，支持配置 API Key、Base URL、可用模型列表，并让 openclaw 在启动时使用当前选择的 Provider 与模型。

---

### 现状梳理
- 当前 Worker 只内建了 Anthropic 与 OpenAI 的配置通道，包含 AI Gateway 入口与直连回退。
  - 环境变量与优先级定义：AI_GATEWAY_* 优先，未设置时回退到 ANTHROPIC_* / OPENAI_*。
  - Base URL 通过 AI_GATEWAY_BASE_URL 或 ANTHROPIC_BASE_URL 传递给容器。
- openclaw 依赖容器启动时注入环境变量，运行中不动态变更。

---

### 结论概览
- 现有代码层面“已支持的 Provider”是 Anthropic 与 OpenAI 两类。
- 多 Provider 管理可行，但需新增“配置存储 + 启动时加载 + Admin 管理 API + 前端界面”四块。
- @movevom/ai-api-manager 是全量聚合包，包含 OpenAI、Anthropic、Gemini、DeepSeek 等适配器，并提供统一 catalog/providerId 机制，可直接拿到 provider 基础信息与模型列表。[来源](https://www.npmjs.com/package/@movevom/ai-api-manager)
- Cloudflare Workers AI 可作为高优先级“免费额度”选项列入列表，按模型执行时消耗 Neurons，每天提供 10,000 Neurons 免费额度，超出后按用量计费。[来源](https://developers.cloudflare.com/workers-ai/platform/pricing/)

---

### 方案设计
#### 1) 数据模型（持久化）
建议存储为加密配置，避免明文 API Key：
- storage: R2 / KV（二选一，R2 与现有管理逻辑一致）
- master key: 新增环境变量 AI_CONFIG_MASTER_KEY，用于 WebCrypto 加解密

示例结构（加密后写入 storage）：
```json
{
  "version": 1,
  "primaryProviderId": "openai-main",
  "primaryModel": "gpt-4.1-mini",
  "fallbackOrder": ["openai-main", "anthropic-main", "deepseek-main"],
  "providers": [
    {
      "id": "openai-main",
      "type": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "enabled": true,
      "apiKeysEncrypted": ["...","..."],
      "models": ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"]
    },
    {
      "id": "anthropic-main",
      "type": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "enabled": true,
      "apiKeysEncrypted": ["..."],
      "models": ["claude-3-5-sonnet", "claude-3-5-haiku"]
    }
  ]
}
```

#### 2) Admin API
新增 /api/admin/ai/*：
- GET /ai/config：返回脱敏配置（不返回 apiKey）
- PUT /ai/config：更新配置（写入加密版本）
- POST /ai/test：使用指定 provider 发起最小请求验证 key/baseUrl
- POST /ai/activate：切换 primaryProviderId + primaryModel，并触发 gateway restart
- POST /ai/fallback/verify：批量校验可用 provider，返回可用列表与失效原因

#### 3) Gateway 启动配置
启动 gateway 前加载配置并覆盖 envVars：
- 如果 primaryProvider.type === "openai"
  - OPENAI_API_KEY = key
  - OPENAI_BASE_URL = baseUrl
- 如果 primaryProvider.type === "anthropic"
  - ANTHROPIC_API_KEY = key
  - ANTHROPIC_BASE_URL = baseUrl
- 如果 primaryProvider.type === "workers-ai"
  - WORKERS_AI_API_TOKEN = key
  - WORKERS_AI_BASE_URL = https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1
  - modelId 使用 @cf/*，通过 OpenAI 兼容接口调用（chat/completions 或 responses）。[来源](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- AI_GATEWAY_* 仍保留为“最高优先级”，当 Admin 配置启用时应禁用 AI_GATEWAY_*，避免冲突。

#### 4) Admin 界面
在 Admin 增加 “AI Provider 管理” 区块：
- Provider 列表（名称、类型、Base URL、可用模型）
- 表单：新增/编辑 Provider（API Key 仅录入，不回显）
- 默认模型选择：provider + model 二级选择
- 验证按钮：调用 /ai/test
- 启用按钮：写入并重启 gateway

---

### @movevom/ai-api-manager 引入策略
它提供统一的 catalog 与 adapters，可直接拉取 provider 与模型列表，减少自维护清单成本。[来源](https://www.npmjs.com/package/@movevom/ai-api-manager)

建议做“可插拔适配层”：
- 定义 ProviderAdapter 接口：
  - listProviders()
  - getProviderConfigSchema(type)
  - buildBaseUrl(type)
  - validateKey(type, key)
- 若 ai-api-manager 可用，则 adapter 直接调用它；
  - 否则 fallback：内建 openai/anthropic 适配。
- UI 层只依赖统一的 ProviderAdapter 输出。

---

### 主 AI / 可用 AI 逻辑
- 可用 AI 规则：provider.enabled === true 且至少 1 个有效 key。
- 主 AI：primaryProviderId + primaryModel 组合。
- 失败切换：主 AI 调用失败时，按 fallbackOrder 顺序选择下一个可用 provider。
- 同一 provider 多 key：支持轮询与健康度退避。
  - 轮询策略：按 keyIndex 循环，失败即标记并冷却一段时间。
  - 退避策略：连续失败 N 次触发 cool-down，避免频繁尝试失效 key。
- Workers AI 作为“免费额度优先”选项：
  - 默认加入可选列表，但不强制主选
  - 明示“免费但质量不一定稳定，由用户决定是否启用”
  - 可配置为 fallbackOrder 的靠前位置

---

### 任务分配与策略路由
主 AI 可基于策略选择其他 provider/模型执行不同任务：
- 任务类型：代码、写作、中文写作、总结等。
- 成本约束：优先成本更低或配额更充足的 provider。
- 质量偏好：指定高质量模型优先。
  - 免费额度优先：当 Workers AI 当日 Neurons 未用尽时可优先选择。[来源](https://developers.cloudflare.com/workers-ai/platform/pricing/)

建议新增 “routingPolicy” 配置，支持：
- 静态规则：例如代码默认 claude，中文写作默认 deepseek-chat。
- 动态策略：由主 AI 评估任务类型与成本后选择最佳 provider。

---

### 可行性回答
方案可行，但需要满足两点：
- API Key 必须在服务端存储并加密，不能明文写入 R2/KV。
- openclaw 必须在重启 gateway 时读取当前默认 Provider 配置并注入 env。

---

### 实施步骤
1. 增加 AI 配置存储与加解密工具
2. 增加 /api/admin/ai/* 路由
3. 修改 gateway 启动逻辑，支持覆盖 provider env
4. Admin UI 增加 Provider 管理界面
5. 接入/适配 ai-api-manager（若可用）
