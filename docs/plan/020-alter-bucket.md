# 020 - 默认 R2 存储桶命名调整

## 目的
- 避免默认桶名固定，方便多次部署与环境隔离。
- 保持可配置性：当显式设置 `R2_BUCKET_NAME` 时仍按用户指定的桶名。

## 逻辑
- 若存在 `R2_BUCKET_NAME`，直接使用该值。
- 否则生成默认桶名：`openclaw-yyyymmdd-<suffix>`。
- `suffix` 从 `shu/niu/hu/tu/long/she/ma/yang/hou/ji/gou/zhu` 中随机选取。
- 默认桶名在进程内缓存，确保一次运行期间始终一致。

## 具体实现
- 在 `src/config.ts` 增加默认桶名生成函数与缓存。
- `getR2BucketName` 优先读取 `R2_BUCKET_NAME`，否则返回缓存的默认桶名。
- 测试用例固定时间与随机值，保证桶名断言稳定。

## 影响范围
- 仅影响未设置 `R2_BUCKET_NAME` 的默认桶名选择。
- 不改变已显式配置桶名的行为。
