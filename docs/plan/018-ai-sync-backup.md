# 018 - FUHUO 复活协议

## 目标
以 FUHUO 协议体系替代旧的 BACKUP/SYNC 逻辑，通过本地与云端的 FUHUO-FILES-TREE.json 决策出生、上传、归来。

## 可行性结论
可行。FUHUO 协议通过环境变量获取 R2 凭据，在容器内独立执行，重启后 AI 读取协议并自动完成决策与同步。

## 前置条件
1. 容器内存在可执行的 Node 环境
2. 已安装 @aws-sdk/client-s3
3. 已设置 BACKUP_R2_* 环境变量

## 决策场景
1. 本地与云端均无 FUHUO-FILES-TREE.json：执行 FUHUO-BIRTH
2. 本地有、云端无：执行 FUHUO-UPLOAD
3. 本地与云端都有：有差异执行 FUHUO-UPLOAD，无差异不上传
4. 本地无、云端有：执行 FUHUO-RELIVE

## 方案落地
- FUHUO-PROTOCOL.md 负责入口检查与决策
- FUHUO-BIRTH.md 定义首次出生流程
- FUHUO-UPLOAD.md 定义上传与文件树生成
- FUHUO-RELIVE.md 定义归来恢复流程

## 风险与应对
- 路径错配风险：统一以 `fuhuo/files/` 作为远端文件根
- 覆盖风险：归来协议默认覆盖本地同名文件
- 依赖缺失风险：脚本内显式校验环境变量并失败退出

## 验收标准
- 复活协议能正确选择出生、上传、归来
- 归来协议能把云端文件恢复到正确本地路径
- 不依赖管理界面即可完成同步
