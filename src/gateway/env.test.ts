import { describe, it, expect } from 'vitest';
import { buildEnvVars } from './env';
import { createMockEnv } from '../test-utils';

describe('buildEnvVars', () => {
  it('returns empty object when no env vars set', () => {
    const env = createMockEnv();
    const result = buildEnvVars(env);
    expect(result).toEqual({});
  });

  it('includes ANTHROPIC_API_KEY when set directly', () => {
    const env = createMockEnv({ ANTHROPIC_API_KEY: 'sk-test-key' });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-test-key');
  });

  it('maps AI_GATEWAY_API_KEY to ANTHROPIC_API_KEY for Anthropic gateway', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-gateway-key');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic');
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

  it('maps AI_GATEWAY_API_KEY to OPENAI_API_KEY for OpenAI gateway', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/openai',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-gateway-key');
    expect(result.OPENAI_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('maps DeepSeek base url and key to OpenAI env when set', () => {
    const env = createMockEnv({
      DEEPSEEK_API_KEY: 'sk-deepseek',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/',
    });
    const result = buildEnvVars(env);
    expect(result.DEEPSEEK_API_KEY).toBe('sk-deepseek');
    expect(result.OPENAI_API_KEY).toBe('sk-deepseek');
    expect(result.DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com');
    expect(result.OPENAI_BASE_URL).toBe('https://api.deepseek.com');
  });

  it('maps Kimi base url and key to OpenAI env when set', () => {
    const env = createMockEnv({
      KIMI_API_KEY: 'sk-kimi',
      KIMI_BASE_URL: 'https://api.moonshot.cn/v1/',
    });
    const result = buildEnvVars(env);
    expect(result.KIMI_API_KEY).toBe('sk-kimi');
    expect(result.OPENAI_API_KEY).toBe('sk-kimi');
    expect(result.KIMI_BASE_URL).toBe('https://api.moonshot.cn/v1');
    expect(result.OPENAI_BASE_URL).toBe('https://api.moonshot.cn/v1');
  });

  it('maps ChatGLM base url and key to Anthropic env when set', () => {
    const env = createMockEnv({
      CHATGLM_API_KEY: 'sk-chatglm',
      CHATGLM_BASE_URL: 'https://api.chatglm.cn/v1/',
    });
    const result = buildEnvVars(env);
    expect(result.CHATGLM_API_KEY).toBe('sk-chatglm');
    expect(result.ANTHROPIC_API_KEY).toBe('sk-chatglm');
    expect(result.CHATGLM_BASE_URL).toBe('https://api.chatglm.cn/v1');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.chatglm.cn/v1');
  });

  it('uses DeepSeek env when primary provider is deepseek', () => {
    const env = createMockEnv({
      AI_PRIMARY_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/',
      AI_GATEWAY_API_KEY: 'gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/openai',
    });
    const result = buildEnvVars(env);
    expect(result.DEEPSEEK_API_KEY).toBe('sk-deepseek');
    expect(result.OPENAI_API_KEY).toBe('sk-deepseek');
    expect(result.DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com');
    expect(result.OPENAI_BASE_URL).toBe('https://api.deepseek.com');
    expect(result.AI_GATEWAY_BASE_URL).toBeUndefined();
  });

  it('uses Kimi env when primary provider is kimi', () => {
    const env = createMockEnv({
      AI_PRIMARY_PROVIDER: 'kimi',
      KIMI_API_KEY: 'sk-kimi',
      KIMI_BASE_URL: 'https://api.moonshot.cn/v1/',
      AI_GATEWAY_API_KEY: 'gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/openai',
    });
    const result = buildEnvVars(env);
    expect(result.KIMI_API_KEY).toBe('sk-kimi');
    expect(result.OPENAI_API_KEY).toBe('sk-kimi');
    expect(result.KIMI_BASE_URL).toBe('https://api.moonshot.cn/v1');
    expect(result.OPENAI_BASE_URL).toBe('https://api.moonshot.cn/v1');
    expect(result.AI_GATEWAY_BASE_URL).toBeUndefined();
  });

  it('uses ChatGLM env when primary provider is chatglm', () => {
    const env = createMockEnv({
      AI_PRIMARY_PROVIDER: 'chatglm',
      CHATGLM_API_KEY: 'sk-chatglm',
      CHATGLM_BASE_URL: 'https://api.chatglm.cn/v1/',
      AI_GATEWAY_API_KEY: 'gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/anthropic',
    });
    const result = buildEnvVars(env);
    expect(result.CHATGLM_API_KEY).toBe('sk-chatglm');
    expect(result.ANTHROPIC_API_KEY).toBe('sk-chatglm');
    expect(result.CHATGLM_BASE_URL).toBe('https://api.chatglm.cn/v1');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.chatglm.cn/v1');
    expect(result.AI_GATEWAY_BASE_URL).toBeUndefined();
  });

  it('uses OpenAI env when primary provider is openai even with DeepSeek configured', () => {
    const env = createMockEnv({
      AI_PRIMARY_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-openai',
      OPENAI_BASE_URL: 'https://api.openai.com/v1/',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-openai');
    expect(result.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(result.DEEPSEEK_BASE_URL).toBeUndefined();
  });

  it('prefers OpenAI base url over DeepSeek when primary provider is auto', () => {
    const env = createMockEnv({
      OPENAI_API_KEY: 'sk-openai',
      OPENAI_BASE_URL: 'https://api.openai.com/v1/',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-openai');
    expect(result.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(result.DEEPSEEK_BASE_URL).toBeUndefined();
  });

  it('passes AI_GATEWAY_BASE_URL directly', () => {
    const env = createMockEnv({
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    });
    const result = buildEnvVars(env);
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic');
  });

  it('AI_GATEWAY_* takes precedence over direct provider keys for Anthropic', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/anthropic',
      ANTHROPIC_API_KEY: 'direct-key',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('gateway-key');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.example.com/anthropic');
  });

  it('AI_GATEWAY_* takes precedence over direct provider keys for OpenAI', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/openai',
      OPENAI_API_KEY: 'direct-key',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('gateway-key');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.example.com/openai');
    expect(result.OPENAI_BASE_URL).toBe('https://gateway.example.com/openai');
  });

  it('falls back to ANTHROPIC_* when AI_GATEWAY_* not set', () => {
    const env = createMockEnv({
      ANTHROPIC_API_KEY: 'direct-key',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('direct-key');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });

  it('includes OPENAI_API_KEY when set directly (no gateway)', () => {
    const env = createMockEnv({ OPENAI_API_KEY: 'sk-openai-key' });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-openai-key');
  });

  it('maps MOLTBOT_GATEWAY_TOKEN to CLAWDBOT_GATEWAY_TOKEN for container', () => {
    const env = createMockEnv({ MOLTBOT_GATEWAY_TOKEN: 'my-token' });
    const result = buildEnvVars(env);
    expect(result.CLAWDBOT_GATEWAY_TOKEN).toBe('my-token');
  });

  it('includes all channel tokens when set', () => {
    const env = createMockEnv({
      TELEGRAM_BOT_TOKEN: 'tg-token',
      TELEGRAM_DM_POLICY: 'pairing',
      DISCORD_BOT_TOKEN: 'discord-token',
      DISCORD_DM_POLICY: 'open',
      SLACK_BOT_TOKEN: 'slack-bot',
      SLACK_APP_TOKEN: 'slack-app',
    });
    const result = buildEnvVars(env);
    
    expect(result.TELEGRAM_BOT_TOKEN).toBe('tg-token');
    expect(result.TELEGRAM_DM_POLICY).toBe('pairing');
    expect(result.DISCORD_BOT_TOKEN).toBe('discord-token');
    expect(result.DISCORD_DM_POLICY).toBe('open');
    expect(result.SLACK_BOT_TOKEN).toBe('slack-bot');
    expect(result.SLACK_APP_TOKEN).toBe('slack-app');
  });

  it('includes backup R2 env vars when set', () => {
    const env = createMockEnv({
      BACKUP_R2_ACCESS_KEY_ID: 'backup-key-id',
      BACKUP_R2_SECRET_ACCESS_KEY: 'backup-secret',
      BACKUP_R2_BUCKET_NAME: 'backup-bucket',
      BACKUP_R2_ACCOUNT_ID: 'backup-account',
    });
    const result = buildEnvVars(env);
    expect(result.BACKUP_R2_ACCESS_KEY_ID).toBe('backup-key-id');
    expect(result.BACKUP_R2_SECRET_ACCESS_KEY).toBe('backup-secret');
    expect(result.BACKUP_R2_BUCKET_NAME).toBe('backup-bucket');
    expect(result.BACKUP_R2_ACCOUNT_ID).toBe('backup-account');
  });

  it('includes coder tokens when set', () => {
    const env = createMockEnv({
      CODER_GITHUB_TOKEN: 'gh-token',
      CODER_NPM_TOKEN: 'npm-token',
    });
    const result = buildEnvVars(env);
    expect(result.CODER_GITHUB_TOKEN).toBe('gh-token');
    expect(result.CODER_NPM_TOKEN).toBe('npm-token');
  });

  it('maps DEV_MODE to CLAWDBOT_DEV_MODE for container', () => {
    const env = createMockEnv({
      DEV_MODE: 'true',
      CLAWDBOT_BIND_MODE: 'lan',
    });
    const result = buildEnvVars(env);
    
    expect(result.CLAWDBOT_DEV_MODE).toBe('true');
    expect(result.CLAWDBOT_BIND_MODE).toBe('lan');
  });

  it('combines all env vars correctly', () => {
    const env = createMockEnv({
      ANTHROPIC_API_KEY: 'sk-key',
      MOLTBOT_GATEWAY_TOKEN: 'token',
      TELEGRAM_BOT_TOKEN: 'tg',
    });
    const result = buildEnvVars(env);
    
    expect(result).toEqual({
      ANTHROPIC_API_KEY: 'sk-key',
      CLAWDBOT_GATEWAY_TOKEN: 'token',
      TELEGRAM_BOT_TOKEN: 'tg',
    });
  });

  it('handles trailing slash in AI_GATEWAY_BASE_URL for OpenAI', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/openai/',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-gateway-key');
    expect(result.OPENAI_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('handles trailing slash in AI_GATEWAY_BASE_URL for Anthropic', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic/',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-gateway-key');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic');
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

  it('handles multiple trailing slashes in AI_GATEWAY_BASE_URL', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/openai///',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-gateway-key');
    expect(result.OPENAI_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
  });
});
