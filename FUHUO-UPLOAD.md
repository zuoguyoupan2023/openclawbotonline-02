# FUHUO-UPLOAD

## 目标
生成本地 `FUHUO-FILES-TREE.json` 并执行差异化上传与删除同步。

## 需要的环境变量
- BACKUP_R2_ACCESS_KEY_ID
- BACKUP_R2_SECRET_ACCESS_KEY
- BACKUP_R2_ACCOUNT_ID
- BACKUP_R2_BUCKET_NAME
- BACKUP_R2_ENDPOINT（可选）
- BACKUP_R2_PREFIX（可选）

## 路径映射
- 本地根目录：`/root/clawd`
- 远端树文件：`{BACKUP_R2_PREFIX}/fuhuo/FUHUO-FILES-TREE.json`
- 远端文件根：`{BACKUP_R2_PREFIX}/fuhuo/files/`
- 特殊配置文件：`/root/.openclaw/openclaw.json` 或 `/root/.clawdbot/clawdbot.json` 映射为 `openclaw/openclaw.json` 或 `openclaw/clawdbot.json`

## 差异策略
- 新增文件：上传
- 内容变更：基于 hash 变化上传
- 本地已删除：远端同步删除

## 使用方式
1. 安装依赖
```bash
cd /root/clawd
npm install @aws-sdk/client-s3
```

2. 将脚本保存为 `/root/clawd/scripts/fuhuo_upload.js`
```javascript
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectsCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const required = [
  'BACKUP_R2_ACCESS_KEY_ID',
  'BACKUP_R2_SECRET_ACCESS_KEY',
  'BACKUP_R2_ACCOUNT_ID',
  'BACKUP_R2_BUCKET_NAME',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing env: ${missing.join(', ')}`);
  process.exit(1);
}

const accountId = process.env.BACKUP_R2_ACCOUNT_ID;
const endpoint = process.env.BACKUP_R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
const bucket = process.env.BACKUP_R2_BUCKET_NAME;
const prefix = (process.env.BACKUP_R2_PREFIX || '').replace(/^\/+|\/+$/g, '');
const basePrefix = prefix ? `${prefix}/` : '';

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: process.env.BACKUP_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.BACKUP_R2_SECRET_ACCESS_KEY,
  },
});

const rootDir = '/root/clawd';
const coreDir = path.join(rootDir, 'core');
const skillsDir = path.join(rootDir, 'skills');
const scriptsDir = path.join(rootDir, 'scripts');
const configDir = path.join(rootDir, 'config');
const openclawDir = fs.existsSync('/root/.openclaw') ? '/root/.openclaw' : '/root/.clawdbot';
const openclawConfig = fs.existsSync(path.join(openclawDir, 'openclaw.json'))
  ? path.join(openclawDir, 'openclaw.json')
  : path.join(openclawDir, 'clawdbot.json');

const excluded = new Set(['.git', 'node_modules']);

const isDirectory = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const listFiles = async (dir) => {
  if (!isDirectory(dir)) return [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFiles(full);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
};

const sha256 = async (filePath) => {
  const data = await fsp.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
};

const buildEntries = async () => {
  const entries = [];
  const coreFiles = await listFiles(coreDir);
  const skillsFiles = await listFiles(skillsDir);
  const scriptsFiles = await listFiles(scriptsDir);
  const configFiles = await listFiles(configDir);

  for (const filePath of coreFiles) {
    const rel = path.relative(coreDir, filePath).split(path.sep).join('/');
    entries.push({ local: filePath, rel: `core/${rel}` });
  }
  for (const filePath of skillsFiles) {
    const rel = path.relative(skillsDir, filePath).split(path.sep).join('/');
    entries.push({ local: filePath, rel: `skills/${rel}` });
  }
  for (const filePath of scriptsFiles) {
    const rel = path.relative(scriptsDir, filePath).split(path.sep).join('/');
    entries.push({ local: filePath, rel: `scripts/${rel}` });
  }
  for (const filePath of configFiles) {
    const rel = path.relative(configDir, filePath).split(path.sep).join('/');
    entries.push({ local: filePath, rel: `config/${rel}` });
  }
  if (isFile(openclawConfig)) {
    const name = path.basename(openclawConfig);
    entries.push({ local: openclawConfig, rel: `openclaw/${name}` });
  }
  return entries;
};

const buildTree = async (entries) => {
  const files = [];
  for (const entry of entries) {
    const stats = await fsp.stat(entry.local);
    const hash = await sha256(entry.local);
    files.push({
      path: entry.rel,
      hash,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
  };
};

const writeTreeFile = async (tree) => {
  const treePath = path.join(rootDir, 'FUHUO-FILES-TREE.json');
  await fsp.writeFile(treePath, JSON.stringify(tree, null, 2));
  return treePath;
};

const uploadObject = async (key, body) => {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
    })
  );
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const fetchRemoteTree = async () => {
  const treeKey = `${basePrefix}fuhuo/FUHUO-FILES-TREE.json`;
  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: treeKey,
      })
    );
    const body = await streamToBuffer(res.Body);
    return JSON.parse(body.toString('utf8'));
  } catch (err) {
    if (err && err.$metadata && err.$metadata.httpStatusCode === 404) {
      return null;
    }
    if (err && err.name === 'NoSuchKey') {
      return null;
    }
    throw err;
  }
};

const toMap = (tree) => {
  if (!tree || !Array.isArray(tree.files)) return new Map();
  return new Map(tree.files.map((item) => [item.path, item]));
};

const deleteRemoteObjects = async (paths) => {
  const chunks = [];
  for (let i = 0; i < paths.length; i += 1000) {
    chunks.push(paths.slice(i, i + 1000));
  }
  for (const chunk of chunks) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((rel) => ({
            Key: `${basePrefix}fuhuo/files/${rel}`,
          })),
          Quiet: true,
        },
      })
    );
  }
};

const run = async () => {
  const entries = await buildEntries();
  const tree = await buildTree(entries);
  const treePath = await writeTreeFile(tree);
  const remoteTree = await fetchRemoteTree();
  const localMap = toMap(tree);
  const remoteMap = toMap(remoteTree);
  const uploadList = [];
  const deleteList = [];

  for (const [rel, item] of localMap.entries()) {
    const remote = remoteMap.get(rel);
    if (!remote || remote.hash !== item.hash) {
      uploadList.push(rel);
    }
  }
  for (const [rel] of remoteMap.entries()) {
    if (!localMap.has(rel)) {
      deleteList.push(rel);
    }
  }

  for (const rel of uploadList) {
    const entry = entries.find((item) => item.rel === rel);
    if (!entry) continue;
    const data = await fsp.readFile(entry.local);
    const key = `${basePrefix}fuhuo/files/${rel}`;
    await uploadObject(key, data);
  }
  if (deleteList.length > 0) {
    await deleteRemoteObjects(deleteList);
  }
  const treeKey = `${basePrefix}fuhuo/FUHUO-FILES-TREE.json`;
  await uploadObject(treeKey, await fsp.readFile(treePath));
  console.log('FUHUO upload completed');
};

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

3. 执行上传
```bash
node /root/clawd/scripts/fuhuo_upload.js
```
