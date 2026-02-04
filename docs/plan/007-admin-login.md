### 目标
为管理后台增加“应用内登录”，在 Cloudflare Access 之外再做一层验证。比较三种方案：账号密码（保存在 Cloudflare 环境变量）、邮箱验证码登录、短信验证码登录，并给出实现路径与优劣对比。

### 方案 A：账号密码（保存在 Cloudflare 环境变量）
#### 实现路径
- 存储：在 Cloudflare 环境变量中设置 ADMIN_USERNAME 与 ADMIN_PASSWORD_HASH（只存哈希，不存明文）。
- 哈希：使用 WebCrypto 的 PBKDF2/SHA-256（或 scrypt）在 Worker 端校验，客户端不参与哈希策略。
- 登录接口：新增 /api/auth/login，接收用户名与密码，校验通过后签发短期 JWT（由环境变量 ADMIN_JWT_SECRET 签名），写入 HttpOnly Cookie。
- 访问控制：在 /api/admin 路由前增加“登录会话中间件”，要求 Cookie 中的 JWT 有效。
- 前端：Admin UI 增加登录页与退出按钮；未登录时仅展示登录界面。
- 安全增强：加上登录失败次数限制（Durable Object 或 KV 记录 IP/账号维度计数）与冷却时间。
- 使用次数提醒：登录成功后统计“当前密码哈希”的累计成功次数，超过 6 次时在登录后的页面弹出 Toast 提示“密码使用超过 6 次，建议更换密码”。仅提示不强制，在密码更换时重置计数。

#### Cloudflare 相关能力
- 环境变量：Workers vars / secrets
- WebCrypto：Worker 内建
- 会话存储：JWT + HttpOnly Cookie
- 频率限制：Durable Object / KV
- 使用次数统计：Durable Object / KV

#### 优点
- 实现简单，依赖少，稳定可控
- 无需引入外部邮件服务
- 权限边界清晰，适合单管理员或少量管理员

#### 缺点
- 密码轮换/多人管理不方便
- 容易被弱口令或泄漏风险影响
- 无法天然追踪“人”的身份（多人共享账号）

---

### 方案 B：邮箱验证码（Email OTP）
#### 实现路径
- 邮件发送：
  - 使用 MailChannels（可在 Worker 里通过 fetch 调用）或第三方如 Postmark/SendGrid。
  - Cloudflare Email Routing 主要用于收件转发，不是直接发件服务。
- 发送验证码接口：/api/auth/otp/request
  - 生成 6 位验证码，存入 KV 或 Durable Object（带 TTL，例如 5 分钟）。
  - 记录发送次数与 IP 频率限制，防刷。
- 校验接口：/api/auth/otp/verify
  - 校验验证码与 TTL，成功后签发 JWT 并写入 HttpOnly Cookie。
- 前端：登录页仅需邮箱地址与验证码输入。
- 安全增强：每个邮箱/IP 的发送次数上限，错误次数锁定，验证码一次性使用。

#### Cloudflare 相关能力
- 发送邮件：需第三方服务（MailChannels 可用，但需配置与合规模板）
- 存储/限流：KV / Durable Object
- 会话：JWT + HttpOnly Cookie

#### 优点
- 无需存储密码，用户体验好
- 便于管理员多人管理（邮箱即身份）
- 可与审计系统结合（按邮箱记录操作）

#### 缺点
- 依赖外部邮件服务与投递稳定性
- 实现更复杂，必须做严格限流与防刷
- 邮件可能延迟或进入垃圾箱

---

### 方案 C：短信验证码（SMS OTP）
#### 可行性与实现路径
- Cloudflare 本身没有原生短信服务，需要接入第三方短信提供商的 API。
- Workers 可通过 HTTP 调用第三方短信服务，官方文档示例包含在 Worker 中调用 Twilio 发送短信的流程，可作为接入样例。https://developers.cloudflare.com/workers/tutorials/github-sms-notifications-using-twilio/
- 发送验证码接口：/api/auth/sms/request
  - 生成 6 位验证码，存入 KV 或 Durable Object（TTL 例如 5 分钟）。
  - 严格限流：手机号/IP/设备维度计数与冷却时间。
- 校验接口：/api/auth/sms/verify
  - 验证成功后签发 JWT 并写入 HttpOnly Cookie。
- 前端：登录页为手机号输入 + 短信验证码输入。

#### Cloudflare 相关能力与第三方服务
- Cloudflare 无内置短信发送能力，需接入 Twilio、阿里云短信、腾讯云短信等第三方服务。
- Twilio：提供短信定价 API，价格按国家/运营商区分，需要查询对应国家/地区的单价。https://www.twilio.com/docs/messaging/api/pricing
- 阿里云短信：提供按国家/地区计费的定价与计费规则说明。https://www.alibabacloud.com/help/en/sms/product-overview/pricing
- 腾讯云短信：提供按国家/地区计费的单价表与包量说明。https://intl.cloud.tencent.com/pricing/sms?lang=en

#### 价格说明
- 短信价格与地区、运营商、模板类型有关，通常为“按条计费 + 国家/地区差异定价”。
- 具体单价需在供应商控制台或公开价目表查询，建议在文档中固定链接，运行时从供应商 API 或后台页面核对。

#### 优点
- 对无邮箱环境更友好，触达率高（但依赖运营商）
- 适合移动端或对邮箱不稳定的地区

#### 缺点
- 依赖外部短信供应商与合规审核
- 成本高于邮件，且价格随地区差异大
- 需要更严格的防刷与成本控制

---

### 与 Cloudflare Access 的关系
Cloudflare Access 的 One-Time PIN 是“页面访问前的网关验证”，不是应用内登录。可作为外层防护，但如果需要“应用内识别用户身份”，仍需以上方案之一。

---

### 对比与选择建议
| 维度 | 账号密码（环境变量） | 邮箱验证码 | 短信验证码 |
| --- | --- | --- | --- |
| 实现复杂度 | 低 | 中-高 | 中-高 |
| 依赖外部服务 | 无 | 有（邮件发送） | 有（短信发送） |
| 多管理员支持 | 弱 | 强 | 强 |
| 安全性 | 取决于口令与防爆破 | 取决于邮件与限流 | 取决于短信与限流 |
| 运维成本 | 低 | 中 | 中-高 |
| 可审计性 | 低 | 高 | 高 |
| 单次成本 | 低 | 低-中 | 中-高 |

#### 推荐组合
- 若仅你个人使用，优先选 方案 A，快速落地。
- 若希望多人管理或有审计需求，优先选 方案 B。
- 若主要用户在移动端或邮箱不稳定地区，可选 方案 C，但需关注成本与合规。
- 最佳实践：保留 Cloudflare Access 作为外层门禁，再加应用内登录。

---

### 安全注意事项
- 账号密码方案必须只存哈希，不存明文。
- OTP 方案必须做频率限制与验证码 TTL。
- JWT 必须设置短有效期（例如 1-4 小时），并支持手动失效。
- 操作日志建议记录邮箱/用户名与时间戳。
