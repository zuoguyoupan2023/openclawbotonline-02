### 概述
本文说明在 Admin UI 中如何在 Anthropic、OpenAI、DeepSeek 三种模式之间切换，以及四家 provider（Anthropic / OpenAI / DeepSeek / MiniMax）的实际运行逻辑与对应的配置入口。

### 三种模式（Anthropic / OpenAI / DeepSeek）
#### 1) Anthropic 模式
- 选择项：Primary Provider = Anthropic
- 使用的配置键：
  - ANTHROPIC_BASE_URL
  - ANTHROPIC_API_KEY
  - 若配置 AI_GATEWAY_BASE_URL 且不是 /openai 结尾，会优先使用 AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY
- 适用场景：
  - 直连 Anthropic
  - 通过 Anthropic 兼容通道运行 MiniMax（见后文 MiniMax 逻辑）

#### 2) OpenAI 模式
- 选择项：Primary Provider = OpenAI
- 使用的配置键：
  - 若 AI_GATEWAY_BASE_URL 以 /openai 结尾，则使用 AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY
  - 否则使用 OPENAI_BASE_URL + OPENAI_API_KEY
- 适用场景：直连 OpenAI 或通过 OpenAI 兼容网关。

#### 3) DeepSeek 模式
- 选择项：Primary Provider = DeepSeek
- 使用的配置键：
  - DEEPSEEK_BASE_URL
  - DEEPSEEK_API_KEY
- 运行逻辑：
  - 将 DEEPSEEK_BASE_URL / DEEPSEEK_API_KEY 映射为 OPENAI_BASE_URL / OPENAI_API_KEY
  - 启动脚本会加载 DeepSeek 的 OpenAI 兼容模型列表

### 四家 Provider 的运行逻辑
#### Anthropic
- 运行通道：Anthropic 模式
- API 类型：anthropic-messages
- 默认模型：Claude 系列（由启动脚本写入 allowlist 与 primary）

#### MiniMax
- 运行通道：Anthropic 模式（通过 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY）
- 关键点：
  - 当 ANTHROPIC_BASE_URL 包含 minimax 时，启动脚本会自动切换到 MiniMax 模型列表
  - 仍然使用 anthropic-messages 通道，不需要额外切换模式

#### OpenAI
- 运行通道：OpenAI 模式
- API 类型：openai-responses
- 可通过 AI Gateway 的 /openai 入口或 OPENAI_BASE_URL 直连

#### DeepSeek
- 运行通道：DeepSeek 模式
- API 类型：openai-responses
- 通过 DEEPSEEK_* 映射到 OPENAI_*，由启动脚本加载 deepseek-chat / deepseek-reasoner

### 使用方法（Admin UI）
1. 进入 AI 管理页面，Primary Provider 选择目标模式：Anthropic / OpenAI / DeepSeek
2. 按模式填写对应的 Base URL 与 API Key
3. 保存后重启网关（或等待网关自动重启）

### 常见问题
1. 选择 Anthropic 但想用 MiniMax
   - 将 MiniMax 的 URL/Key 填入 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY
   - 保持 Primary Provider = Anthropic
2. DeepSeek 与 OpenAI 同时配置但无法切换
   - 使用 Primary Provider 显式选择即可，DeepSeek 不再自动抢占优先级
