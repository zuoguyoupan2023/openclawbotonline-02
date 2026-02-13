import type { MoltbotEnv } from '../types';

/**
 * Build environment variables to pass to the Moltbot container process
 * 
 * @param env - Worker environment bindings
 * @returns Environment variables record
 */
export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  const primaryProvider = env.AI_PRIMARY_PROVIDER?.toLowerCase();
  const normalizedGatewayBaseUrl = env.AI_GATEWAY_BASE_URL?.replace(/\/+$/, '');
  const isOpenAIGateway = normalizedGatewayBaseUrl?.endsWith('/openai');
  const normalizedDeepseekBaseUrl = env.DEEPSEEK_BASE_URL?.replace(/\/+$/, '');
  const normalizedOpenaiBaseUrl = env.OPENAI_BASE_URL?.replace(/\/+$/, '');
  const normalizedAnthropicBaseUrl = env.ANTHROPIC_BASE_URL?.replace(/\/+$/, '');
  const normalizedKimiBaseUrl = env.KIMI_BASE_URL?.replace(/\/+$/, '');
  const normalizedChatglmBaseUrl = env.CHATGLM_BASE_URL?.replace(/\/+$/, '');
  const hasPrimaryProvider = primaryProvider && primaryProvider !== 'auto';

  if (hasPrimaryProvider) {
    if (primaryProvider === 'deepseek') {
      if (normalizedDeepseekBaseUrl) {
        envVars.DEEPSEEK_BASE_URL = normalizedDeepseekBaseUrl;
        envVars.OPENAI_BASE_URL = normalizedDeepseekBaseUrl;
      }
      if (env.DEEPSEEK_API_KEY) {
        envVars.DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
        envVars.OPENAI_API_KEY = env.DEEPSEEK_API_KEY;
      }
    } else if (primaryProvider === 'kimi') {
      if (normalizedKimiBaseUrl) {
        envVars.KIMI_BASE_URL = normalizedKimiBaseUrl;
        envVars.OPENAI_BASE_URL = normalizedKimiBaseUrl;
      }
      if (env.KIMI_API_KEY) {
        envVars.KIMI_API_KEY = env.KIMI_API_KEY;
        envVars.OPENAI_API_KEY = env.KIMI_API_KEY;
      }
    } else if (primaryProvider === 'chatglm') {
      if (normalizedChatglmBaseUrl) {
        envVars.CHATGLM_BASE_URL = normalizedChatglmBaseUrl;
        envVars.ANTHROPIC_BASE_URL = normalizedChatglmBaseUrl;
      }
      if (env.CHATGLM_API_KEY) {
        envVars.CHATGLM_API_KEY = env.CHATGLM_API_KEY;
        envVars.ANTHROPIC_API_KEY = env.CHATGLM_API_KEY;
      }
    } else if (primaryProvider === 'openai') {
      if (normalizedGatewayBaseUrl && isOpenAIGateway) {
        envVars.AI_GATEWAY_BASE_URL = normalizedGatewayBaseUrl;
        if (env.AI_GATEWAY_API_KEY) envVars.OPENAI_API_KEY = env.AI_GATEWAY_API_KEY;
        envVars.OPENAI_BASE_URL = normalizedGatewayBaseUrl;
      } else {
        if (normalizedOpenaiBaseUrl) envVars.OPENAI_BASE_URL = normalizedOpenaiBaseUrl;
        if (env.OPENAI_API_KEY) envVars.OPENAI_API_KEY = env.OPENAI_API_KEY;
      }
    } else {
      if (normalizedGatewayBaseUrl && !isOpenAIGateway) {
        envVars.AI_GATEWAY_BASE_URL = normalizedGatewayBaseUrl;
        if (env.AI_GATEWAY_API_KEY) envVars.ANTHROPIC_API_KEY = env.AI_GATEWAY_API_KEY;
        envVars.ANTHROPIC_BASE_URL = normalizedGatewayBaseUrl;
      } else {
        if (normalizedAnthropicBaseUrl) envVars.ANTHROPIC_BASE_URL = normalizedAnthropicBaseUrl;
        if (env.ANTHROPIC_API_KEY) envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
      }
    }
  } else {
    if (normalizedGatewayBaseUrl) {
      envVars.AI_GATEWAY_BASE_URL = normalizedGatewayBaseUrl;
      if (isOpenAIGateway) {
        if (env.AI_GATEWAY_API_KEY) envVars.OPENAI_API_KEY = env.AI_GATEWAY_API_KEY;
        envVars.OPENAI_BASE_URL = normalizedGatewayBaseUrl;
      } else {
        if (env.AI_GATEWAY_API_KEY) envVars.ANTHROPIC_API_KEY = env.AI_GATEWAY_API_KEY;
        envVars.ANTHROPIC_BASE_URL = normalizedGatewayBaseUrl;
      }
    } else if (normalizedOpenaiBaseUrl) {
      envVars.OPENAI_BASE_URL = normalizedOpenaiBaseUrl;
      if (env.OPENAI_API_KEY) envVars.OPENAI_API_KEY = env.OPENAI_API_KEY;
    } else if (normalizedAnthropicBaseUrl) {
      envVars.ANTHROPIC_BASE_URL = normalizedAnthropicBaseUrl;
      if (env.ANTHROPIC_API_KEY) envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
    } else if (normalizedChatglmBaseUrl) {
      envVars.CHATGLM_BASE_URL = normalizedChatglmBaseUrl;
      envVars.ANTHROPIC_BASE_URL = normalizedChatglmBaseUrl;
      if (env.CHATGLM_API_KEY) {
        envVars.CHATGLM_API_KEY = env.CHATGLM_API_KEY;
        envVars.ANTHROPIC_API_KEY = env.CHATGLM_API_KEY;
      }
    } else if (normalizedDeepseekBaseUrl) {
      envVars.DEEPSEEK_BASE_URL = normalizedDeepseekBaseUrl;
      envVars.OPENAI_BASE_URL = normalizedDeepseekBaseUrl;
      if (env.DEEPSEEK_API_KEY) {
        envVars.DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
        envVars.OPENAI_API_KEY = env.DEEPSEEK_API_KEY;
      }
    } else if (normalizedKimiBaseUrl) {
      envVars.KIMI_BASE_URL = normalizedKimiBaseUrl;
      envVars.OPENAI_BASE_URL = normalizedKimiBaseUrl;
      if (env.KIMI_API_KEY) {
        envVars.KIMI_API_KEY = env.KIMI_API_KEY;
        envVars.OPENAI_API_KEY = env.KIMI_API_KEY;
      }
    } else {
      if (env.AI_GATEWAY_API_KEY) {
        if (isOpenAIGateway) {
          envVars.OPENAI_API_KEY = env.AI_GATEWAY_API_KEY;
        } else {
          envVars.ANTHROPIC_API_KEY = env.AI_GATEWAY_API_KEY;
        }
      }
      if (env.ANTHROPIC_API_KEY) envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
      if (env.OPENAI_API_KEY) envVars.OPENAI_API_KEY = env.OPENAI_API_KEY;
    }
  }
  // Map MOLTBOT_GATEWAY_TOKEN to CLAWDBOT_GATEWAY_TOKEN (container expects this name)
  if (env.MOLTBOT_GATEWAY_TOKEN) envVars.CLAWDBOT_GATEWAY_TOKEN = env.MOLTBOT_GATEWAY_TOKEN;
  if (env.DEV_MODE) envVars.CLAWDBOT_DEV_MODE = env.DEV_MODE; // Pass DEV_MODE as CLAWDBOT_DEV_MODE to container
  if (env.CLAWDBOT_BIND_MODE) envVars.CLAWDBOT_BIND_MODE = env.CLAWDBOT_BIND_MODE;
  if (env.TELEGRAM_BOT_TOKEN) envVars.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_DM_POLICY) envVars.TELEGRAM_DM_POLICY = env.TELEGRAM_DM_POLICY;
  if (env.DISCORD_BOT_TOKEN) envVars.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
  if (env.DISCORD_DM_POLICY) envVars.DISCORD_DM_POLICY = env.DISCORD_DM_POLICY;
  if (env.SLACK_BOT_TOKEN) envVars.SLACK_BOT_TOKEN = env.SLACK_BOT_TOKEN;
  if (env.SLACK_APP_TOKEN) envVars.SLACK_APP_TOKEN = env.SLACK_APP_TOKEN;
  if (env.CDP_SECRET) envVars.CDP_SECRET = env.CDP_SECRET;
  if (env.WORKER_URL) envVars.WORKER_URL = env.WORKER_URL;
  if (env.DISABLE_R2_STORAGE) envVars.DISABLE_R2_STORAGE = env.DISABLE_R2_STORAGE;
  if (env.BACKUP_R2_ACCESS_KEY_ID) envVars.BACKUP_R2_ACCESS_KEY_ID = env.BACKUP_R2_ACCESS_KEY_ID;
  if (env.BACKUP_R2_SECRET_ACCESS_KEY) envVars.BACKUP_R2_SECRET_ACCESS_KEY = env.BACKUP_R2_SECRET_ACCESS_KEY;
  if (env.BACKUP_R2_ACCOUNT_ID) envVars.BACKUP_R2_ACCOUNT_ID = env.BACKUP_R2_ACCOUNT_ID;
  if (env.BACKUP_R2_BUCKET_NAME) envVars.BACKUP_R2_BUCKET_NAME = env.BACKUP_R2_BUCKET_NAME;
  if (env.CODER_GITHUB_TOKEN) envVars.CODER_GITHUB_TOKEN = env.CODER_GITHUB_TOKEN;
  if (env.CODER_NPM_TOKEN) envVars.CODER_NPM_TOKEN = env.CODER_NPM_TOKEN;

  return envVars;
}
