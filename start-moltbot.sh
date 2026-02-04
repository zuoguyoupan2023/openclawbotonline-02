#!/bin/bash
# Startup script for Moltbot in Cloudflare Sandbox
# This script:
# 1. Restores config from R2 backup if available
# 2. Configures moltbot from environment variables
# 3. Starts a background sync to backup config to R2
# 4. Starts the gateway

set -e

# Check if gateway is already running - bail early if so
if pgrep -f "openclaw gateway" > /dev/null 2>&1 || pgrep -f "clawdbot gateway" > /dev/null 2>&1; then
    echo "Moltbot gateway is already running, exiting."
    exit 0
fi

CONFIG_DIR="/root/.clawdbot"
CONFIG_FILE="$CONFIG_DIR/clawdbot.json"
TEMPLATE_DIR="/root/.clawdbot-templates"
TEMPLATE_FILE="$TEMPLATE_DIR/moltbot.json.template"
BACKUP_DIR="/data/moltbot"

echo "Config directory: $CONFIG_DIR"
echo "Backup directory: $BACKUP_DIR"

# Create config directory
mkdir -p "$CONFIG_DIR" "$TEMPLATE_DIR"
ln -sfn "$CONFIG_DIR" /root/.openclaw
ln -sfn "$TEMPLATE_DIR" /root/.openclaw-templates

CLI_BIN="clawdbot"
if command -v openclaw >/dev/null 2>&1; then
    CLI_BIN="openclaw"
fi

# ============================================================
# RESTORE FROM R2 BACKUP
# ============================================================
# Check if R2 backup exists by looking for clawdbot.json
# The BACKUP_DIR may exist but be empty if R2 was just mounted
# Note: backup structure is $BACKUP_DIR/clawdbot/ and $BACKUP_DIR/skills/

# Helper function to check if R2 backup is newer than local
should_restore_from_r2() {
    local R2_SYNC_FILE="$BACKUP_DIR/.last-sync"
    local LOCAL_SYNC_FILE="$CONFIG_DIR/.last-sync"
    
    # If no R2 sync timestamp, don't restore
    if [ ! -f "$R2_SYNC_FILE" ]; then
        echo "No R2 sync timestamp found, skipping restore"
        return 1
    fi
    
    # If no local sync timestamp, restore from R2
    if [ ! -f "$LOCAL_SYNC_FILE" ]; then
        echo "No local sync timestamp, will restore from R2"
        return 0
    fi
    
    # Compare timestamps
    R2_TIME=$(cat "$R2_SYNC_FILE" 2>/dev/null)
    LOCAL_TIME=$(cat "$LOCAL_SYNC_FILE" 2>/dev/null)
    
    echo "R2 last sync: $R2_TIME"
    echo "Local last sync: $LOCAL_TIME"
    
    # Convert to epoch seconds for comparison
    R2_EPOCH=$(date -d "$R2_TIME" +%s 2>/dev/null || echo "0")
    LOCAL_EPOCH=$(date -d "$LOCAL_TIME" +%s 2>/dev/null || echo "0")
    
    if [ "$R2_EPOCH" -gt "$LOCAL_EPOCH" ]; then
        echo "R2 backup is newer, will restore"
        return 0
    else
        echo "Local data is newer or same, skipping restore"
        return 1
    fi
}

if [ -f "$BACKUP_DIR/clawdbot/clawdbot.json" ]; then
    if should_restore_from_r2; then
        echo "Restoring from R2 backup at $BACKUP_DIR/clawdbot..."
        cp -a "$BACKUP_DIR/clawdbot/." "$CONFIG_DIR/"
        # Copy the sync timestamp to local so we know what version we have
        cp -f "$BACKUP_DIR/.last-sync" "$CONFIG_DIR/.last-sync" 2>/dev/null || true
        echo "Restored config from R2 backup"
    fi
elif [ -f "$BACKUP_DIR/clawdbot.json" ]; then
    # Legacy backup format (flat structure)
    if should_restore_from_r2; then
        echo "Restoring from legacy R2 backup at $BACKUP_DIR..."
        cp -a "$BACKUP_DIR/." "$CONFIG_DIR/"
        cp -f "$BACKUP_DIR/.last-sync" "$CONFIG_DIR/.last-sync" 2>/dev/null || true
        echo "Restored config from legacy R2 backup"
    fi
elif [ -d "$BACKUP_DIR" ]; then
    echo "R2 mounted at $BACKUP_DIR but no backup data found yet"
else
    echo "R2 not mounted, starting fresh"
fi

# Restore skills from R2 backup if available (only if R2 is newer)
SKILLS_DIR="/root/clawd/skills"
if [ -d "$BACKUP_DIR/skills" ] && [ "$(ls -A $BACKUP_DIR/skills 2>/dev/null)" ]; then
    if should_restore_from_r2; then
        echo "Restoring skills from $BACKUP_DIR/skills..."
        mkdir -p "$SKILLS_DIR"
        cp -a "$BACKUP_DIR/skills/." "$SKILLS_DIR/"
        echo "Restored skills from R2 backup"
    fi
fi

WORKSPACE_DIR="/root/clawd"
if [ -d "$BACKUP_DIR/workspace-core" ] && [ "$(ls -A $BACKUP_DIR/workspace-core 2>/dev/null)" ]; then
    if should_restore_from_r2 || [ ! -d "$WORKSPACE_DIR" ] || [ -z "$(ls -A "$WORKSPACE_DIR" 2>/dev/null)" ] || [ ! -f "$WORKSPACE_DIR/USER.md" ] || [ ! -f "$WORKSPACE_DIR/SOUL.md" ] || [ ! -f "$WORKSPACE_DIR/MEMORY.md" ]; then
        echo "Restoring workspace core files from $BACKUP_DIR/workspace-core..."
        mkdir -p "$WORKSPACE_DIR"
        rsync -r --no-times --delete \
          --exclude='/.git/' --exclude='/.git/**' \
          --exclude='/skills/' --exclude='/skills/**' \
          --exclude='/node_modules/' --exclude='/node_modules/**' \
          "$BACKUP_DIR/workspace-core/" "$WORKSPACE_DIR/"
        echo "Restored workspace core files from R2 backup"
    fi
fi

# If config file still doesn't exist, create from template
if [ ! -f "$CONFIG_FILE" ]; then
    echo "No existing config found, initializing from template..."
    if [ -f "$TEMPLATE_FILE" ]; then
        cp "$TEMPLATE_FILE" "$CONFIG_FILE"
    else
        # Create minimal config if template doesn't exist
        cat > "$CONFIG_FILE" << 'EOFCONFIG'
{
  "agents": {
    "defaults": {
      "workspace": "/root/clawd"
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local"
  }
}
EOFCONFIG
    fi
else
    echo "Using existing config"
fi

ln -sfn "$CONFIG_FILE" /root/.openclaw/openclaw.json

# ============================================================
# UPDATE CONFIG FROM ENVIRONMENT VARIABLES
# ============================================================
node << EOFNODE
const fs = require('fs');

const configPath = '/root/.clawdbot/clawdbot.json';
console.log('Updating config at:', configPath);
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.log('Starting with empty config');
}

// Ensure nested objects exist
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
const normalizeModelConfig = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        return { primary: value.trim() };
    }
    return {};
};
config.agents.defaults.model = normalizeModelConfig(config.agents.defaults.model);
config.gateway = config.gateway || {};
config.channels = config.channels || {};

// Clean up any broken anthropic provider config from previous runs
// (older versions didn't include required 'name' field)
if (config.models?.providers) {
    Object.entries(config.models.providers).forEach(([key, provider]) => {
        if (!provider || !Array.isArray(provider.models)) return;
        const hasInvalidModels = provider.models.some((model) => !model || !model.name);
        if (hasInvalidModels) {
            console.log(`Removing broken ${key} provider config (missing model names)`);
            delete config.models.providers[key];
        }
    });
}



// Gateway configuration
config.gateway.port = 18789;
config.gateway.mode = 'local';
config.gateway.trustedProxies = ['10.1.0.0'];

// Set gateway token if provided
if (process.env.CLAWDBOT_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.CLAWDBOT_GATEWAY_TOKEN;
}

// Allow insecure auth for dev mode
if (process.env.CLAWDBOT_DEV_MODE === 'true') {
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.allowInsecureAuth = true;
}

// Telegram configuration
if (process.env.TELEGRAM_BOT_TOKEN) {
    config.channels.telegram = config.channels.telegram || {};
    config.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
    config.channels.telegram.enabled = true;
    const telegramDmPolicy = process.env.TELEGRAM_DM_POLICY || 'pairing';
    config.channels.telegram.dmPolicy = telegramDmPolicy;
    if (process.env.TELEGRAM_DM_ALLOW_FROM) {
        // Explicit allowlist: "123,456,789" → ['123', '456', '789']
        config.channels.telegram.allowFrom = process.env.TELEGRAM_DM_ALLOW_FROM.split(',');
    } else if (telegramDmPolicy === 'open') {
        // "open" policy requires allowFrom: ["*"]
        config.channels.telegram.allowFrom = ['*'];
    }
}

// Discord configuration
// Note: Discord uses nested dm.policy, not flat dmPolicy like Telegram
// See: https://github.com/moltbot/moltbot/blob/v2026.1.24-1/src/config/zod-schema.providers-core.ts#L147-L155
if (process.env.DISCORD_BOT_TOKEN) {
    config.channels.discord = config.channels.discord || {};
    config.channels.discord.token = process.env.DISCORD_BOT_TOKEN;
    config.channels.discord.enabled = true;
    const discordDmPolicy = process.env.DISCORD_DM_POLICY || 'pairing';
    config.channels.discord.dm = config.channels.discord.dm || {};
    config.channels.discord.dm.policy = discordDmPolicy;
    // "open" policy requires allowFrom: ["*"]
    if (discordDmPolicy === 'open') {
        config.channels.discord.dm.allowFrom = ['*'];
    }
}

// Slack configuration
if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    config.channels.slack = config.channels.slack || {};
    config.channels.slack.botToken = process.env.SLACK_BOT_TOKEN;
    config.channels.slack.appToken = process.env.SLACK_APP_TOKEN;
    config.channels.slack.enabled = true;
}

const adminProviderType = (process.env.ADMIN_AI_PROVIDER_TYPE || '').trim();
const adminBaseUrl = (process.env.ADMIN_AI_BASE_URL || '').replace(/\/+$/, '');
const adminModelsRaw = (process.env.ADMIN_AI_MODELS || '').trim();
const adminPrimaryModel = (process.env.ADMIN_AI_PRIMARY_MODEL || '').trim();
let adminModels = [];
if (adminModelsRaw) {
    try {
        const parsed = JSON.parse(adminModelsRaw);
        if (Array.isArray(parsed)) {
            adminModels = parsed.filter((item) => typeof item === 'string' && item.trim());
        }
    } catch (e) {
        const message = e && e.message ? e.message : e;
        console.log('Failed to parse ADMIN_AI_MODELS:', message);
    }
}

const gatewayBaseUrl = (process.env.AI_GATEWAY_BASE_URL || '').replace(/\/+$/, '');
const openAiBaseUrl = (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
const anthropicBaseUrl = (process.env.ANTHROPIC_BASE_URL || '').replace(/\/+$/, '');
const baseUrl = (gatewayBaseUrl || openAiBaseUrl || anthropicBaseUrl || '').replace(/\/+$/, '');
const isOpenAI = !!openAiBaseUrl || baseUrl.endsWith('/openai');

const configureProviderModels = (providerKey, baseUrlValue, api, models, primaryModel) => {
    if (!baseUrlValue) return;
    config.models = config.models || {};
    config.models.providers = config.models.providers || {};
    const providerConfig = {
        baseUrl: baseUrlValue,
        api,
        models: models.map((id) => ({
            id,
            name: id,
            contextWindow: 200000,
        })),
    };
    if (providerKey === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
        providerConfig.apiKey = process.env.ANTHROPIC_API_KEY;
    }
    config.models.providers[providerKey] = providerConfig;
    config.agents.defaults.models = config.agents.defaults.models || {};
    models.forEach((id) => {
        config.agents.defaults.models[`${providerKey}/${id}`] = { alias: id };
    });
    if (primaryModel) {
        config.agents.defaults.model.primary = `${providerKey}/${primaryModel}`;
    } else if (models[0]) {
        config.agents.defaults.model.primary = `${providerKey}/${models[0]}`;
    }
};

if (adminProviderType && adminBaseUrl) {
    const providerKey = adminProviderType === 'anthropic' ? 'anthropic' : 'openai';
    const api = providerKey === 'anthropic' ? 'anthropic-messages' : 'openai-responses';
    configureProviderModels(providerKey, adminBaseUrl, api, adminModels, adminPrimaryModel);
} else if (isOpenAI) {
    console.log('Configuring OpenAI provider with base URL:', baseUrl);
    configureProviderModels(
        'openai',
        baseUrl,
        'openai-responses',
        ['gpt-5.2', 'gpt-5', 'gpt-4.5-preview'],
        'gpt-5.2'
    );
} else if (baseUrl) {
    console.log('Configuring Anthropic provider with base URL:', baseUrl);
    configureProviderModels(
        'anthropic',
        baseUrl,
        'anthropic-messages',
        ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
        'claude-opus-4-5-20251101'
    );
} else {
    config.agents.defaults.model.primary = 'anthropic/claude-opus-4-5';
}

if (!config.agents.defaults.model.primary) {
    config.agents.defaults.model.primary = 'anthropic/claude-opus-4-5';
}

// Write updated config
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Configuration updated successfully');
console.log('Config:', JSON.stringify(config, null, 2));
EOFNODE

# ============================================================
# START GATEWAY
# ============================================================
# Note: R2 backup sync is handled by the Worker's cron trigger
echo "Starting Moltbot Gateway..."
echo "Gateway will be available on port 18789"

# Clean up stale lock files
rm -f /tmp/clawdbot-gateway.lock 2>/dev/null || true
rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true

BIND_MODE="lan"
echo "Dev mode: ${CLAWDBOT_DEV_MODE:-false}, Bind mode: $BIND_MODE"

if [ -n "$CLAWDBOT_GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token auth..."
    exec "$CLI_BIN" gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE" --token "$CLAWDBOT_GATEWAY_TOKEN"
else
    echo "Starting gateway with device pairing (no token)..."
    exec "$CLI_BIN" gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE"
fi
