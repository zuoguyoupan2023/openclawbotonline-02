# 独立备份指南 (Indie Backup)


## 概述
绕过 OpenClaw 默认存储桶，直接备份到独立的 R2 存储桶。


## R2 凭证


| 配置项 | 值 |
|--------|-----|
| Account ID | `409198b5a4236cb0` |
| Access Key ID | `d4f72e01e826309` |
| Secret Access Key | `81501507db07ad95a10cc668cdd154c8e90f3` |
| Bucket Name | `openclawbotonline-data-2` |
| Endpoint | `https://409198b578c4277c5a4236cb0.r2.cloudflarestorage.com` |
| Region | `auto` |

## 快速使用


### 安装依赖
```bash
npm install @aws-sdk/client-s3
```


### 运行备份
```bash
node /root/clawd/scripts/r2_backup.js
```


## 备份内容


自动备份以下内容：


1. **核心文档** (`core/`)
   - MEMORY.md、IDENTITY.md、AGENTS.md
   - SOUL.md、USER.md、TOOLS.md
   - HEARTBEAT.md、MAIL-NEWS-MEMORY.md


2. **麦肯锡 Skills** (`skills/`)
   - 查找包含 `mckinsey`、`mck`、`strategy` 的 skills


3. **脚本配置** (`config/`, `scripts/`)
   - 邮件检查、cron 管理、新闻系统
   - cron_backup.json


4. **备份清单** (`_manifest.json`)
   - 完整的备份元数据


## 备份路径格式


```
backups/YYYY-MM-DD/YYYY-MM-DDTHH-MM-SS-mmmZ/
├── core/           # 核心 MD 文档
├── skills/         # Skills 目录
├── scripts/        # 脚本文件
├── config/         # 配置文件
└── _manifest.json  # 备份清单
```


## S3 兼容示例


```javascript
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');


const client = new S3Client({
  region: 'auto',
  endpoint: 'https://40919e8c4277c5a4236cb0.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: 'd4f72e7aab1301e826309',
    secretAccessKey: '81501e61d2ffbee507db07ad95a10cc668cdd154c8e90f3',
  },
});


await client.send(new PutObjectCommand({
  Bucket: 'openclawbotonline-data-2',
  Key: 'test.txt',
  Body: 'Hello R2!',
}));
```


## 安全提示


⚠️ **凭证文件位置**: `/root/clawd/config/backup_secret.json`


该文件包含敏感信息，请勿：
- 提交到 Git 仓库
- 在日志中打印
- 分享给第三方


## 相关文件


- 脚本: `/root/clawd/scripts/r2_backup.js`
- 凭证: `/root/clawd/config/backup_secret.json`
- 本指南: `/root/clawd/docs/indie-backup.md`

