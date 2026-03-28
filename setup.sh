#!/bin/bash
# CamScanner i18n MCP Server + Plugin 一键安装
# 用法: bash setup.sh
set -e

echo "=== CamScanner i18n 多语言工具安装 ==="
echo ""

# ---- 配置 ----
MCP_SERVER_DIR="$HOME/mcp-language-server"
PLUGIN_DIR="$HOME/.claude/plugins/cache/local/i18n/1.0.0"
PLUGINS_JSON="$HOME/.claude/plugins/installed_plugins.json"
SETTINGS_JSON="$HOME/.claude/settings.json"
MCP_JSON="$HOME/.claude/.mcp.json"

# ---- 1. 安装 MCP Server ----
echo "[1/4] 安装 MCP Language Server..."
if [ -d "$MCP_SERVER_DIR" ]; then
  echo "  目录已存在，更新中..."
  cd "$MCP_SERVER_DIR"
  git pull 2>/dev/null || echo "  非 git 仓库，跳过更新"
else
  echo "  克隆仓库..."
  # TODO: 替换为实际的 git 仓库地址
  # git clone https://your-git-repo/mcp-language-server.git "$MCP_SERVER_DIR"
  mkdir -p "$MCP_SERVER_DIR"
  echo "  请手动将 mcp-language-server 项目复制到 $MCP_SERVER_DIR"
fi

cd "$MCP_SERVER_DIR"
if [ -f "package.json" ]; then
  echo "  安装依赖..."
  npm install --silent 2>/dev/null
  echo "  依赖安装完成"
fi

# ---- 2. 配置 Cookie ----
echo ""
echo "[2/4] 配置认证信息..."
if [ ! -f "$MCP_SERVER_DIR/.cookie" ]; then
  echo ""
  echo "  需要配置 Cookie 才能访问多语言平台。"
  echo "  获取方式："
  echo "    1. 浏览器打开 https://operate-test.intsig.net/multilanguage"
  echo "    2. 登录后打开 DevTools → Network"
  echo "    3. 做一次搜索操作，找到 get-string-search 请求"
  echo "    4. 右键 → Copy → Copy as cURL"
  echo "    5. 从 curl 中提取 -b 后面的 cookie 值"
  echo ""
  read -p "  粘贴 Cookie 值 (或回车跳过): " COOKIE_VALUE
  if [ -n "$COOKIE_VALUE" ]; then
    echo "$COOKIE_VALUE" > "$MCP_SERVER_DIR/.cookie"
    echo "  Cookie 已保存"
  else
    echo "  跳过，稍后请手动写入 $MCP_SERVER_DIR/.cookie"
  fi

  echo ""
  read -p "  粘贴 X-CSRF-Token 值 (或回车跳过): " CSRF_VALUE
  if [ -n "$CSRF_VALUE" ]; then
    echo "$CSRF_VALUE" > "$MCP_SERVER_DIR/.csrf-token"
    echo "  CSRF Token 已保存"
  else
    echo "  跳过，稍后请手动写入 $MCP_SERVER_DIR/.csrf-token"
  fi
else
  echo "  Cookie 已存在，跳过"
fi

# ---- 3. 注册 MCP Server ----
echo ""
echo "[3/4] 注册 MCP Server 到 Claude Code..."
mkdir -p "$HOME/.claude"

if [ -f "$MCP_JSON" ]; then
  # 检查是否已注册
  if grep -q '"language"' "$MCP_JSON" 2>/dev/null; then
    echo "  MCP Server 已注册，跳过"
  else
    # 合并到已有配置
    node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('$MCP_JSON', 'utf-8'));
      data.mcpServers = data.mcpServers || {};
      data.mcpServers.language = {
        command: 'node',
        args: ['$MCP_SERVER_DIR/index.js'],
        env: {
          OPERATE_BASE_URL: 'https://operate-test.intsig.net',
          OPERATE_COOKIE: '',
          OPERATE_CSRF_TOKEN: ''
        }
      };
      fs.writeFileSync('$MCP_JSON', JSON.stringify(data, null, 2) + '\n');
    "
    echo "  MCP Server 已注册"
  fi
else
  cat > "$MCP_JSON" << EOF
{
  "mcpServers": {
    "language": {
      "command": "node",
      "args": ["$MCP_SERVER_DIR/index.js"],
      "env": {
        "OPERATE_BASE_URL": "https://operate-test.intsig.net",
        "OPERATE_COOKIE": "",
        "OPERATE_CSRF_TOKEN": ""
      }
    }
  }
}
EOF
  echo "  MCP Server 已注册"
fi

# ---- 4. 安装 i18n Plugin ----
echo ""
echo "[4/4] 安装 i18n Plugin..."
mkdir -p "$PLUGIN_DIR/.claude-plugin"
mkdir -p "$PLUGIN_DIR/skills/i18n"

cat > "$PLUGIN_DIR/.claude-plugin/plugin.json" << 'EOF'
{
  "name": "i18n",
  "description": "CamScanner multi-language string integration plugin with MCP language server",
  "version": "1.0.0",
  "author": { "name": "CamScanner" }
}
EOF

cat > "$PLUGIN_DIR/skills/i18n/SKILL.md" << 'SKILL_EOF'
---
name: i18n
description: "多语言字符串集成助手。当用户要求集成、查询、替换多语言字符串时触发，或用户提到 i18n、多语言、$t、国际化、翻译等关键词时触发。"
argument-hint: <要集成的中文字符串>
disable-model-invocation: false
---

# 多语言字符串集成助手

帮助用户查询、集成 CamScanner 系列产品的多语言字符串到项目代码中。

## 可用 MCP 工具

来自 language MCP server：

1. **search-string** — 按关键词搜索多语言字符串（远程多语言平台）
2. **export-string** — 导出为兼容 cs-i18n 的 locale JSON 格式
3. **write-locales** — 将字符串写入项目的 locales 目录
4. **get-version-list** — 获取产品的版本列表

## 常用产品 ID

| ID | 产品 |
|----|------|
| 1 | CamCard |
| 2 | CamScanner |
| 44 | CamScanner Lite |
| 47 | CS PDF |
| 53 | CS Harmony |

## 项目 i18n 配置

- 框架: vue-i18n
- locale 文件位置: `src/locales/`
- 主参考文件: `src/locales/ZhCn.json`
- 文件格式: **扁平 key-value 结构**，无嵌套
- 参数占位符: `{0}`, `{1}`, `{2}` ...（%s 会自动替换）

## 代码中的使用方式

### 模板中

```vue
{{ $t('key_name') }}
{{ $t('cs_519b_selected_some', [count]) }}
```

### TypeScript 中

```typescript
import { i18n } from '@/i18n'
i18n.global.t('key_name')
i18n.global.t('key_name', [param1, param2])
```

## 工作流程

当用户请求集成一个字符串时，**严格按以下步骤执行**：

### 第 1 步：本地查找（优先）

先在项目本地 locale 文件中搜索，检查是否已存在匹配的字符串：

1. 使用 **Grep 工具**在 `src/locales/ZhCn.json` 中搜索用户提供的中文字符串
2. **严格匹配规则**: value 必须与用户需要的字符串**完全一致**
3. 如果本地找到了完全匹配的 key → **直接使用该 key，跳到第 4 步**

### 第 2 步：远程查询（本地未找到时）

使用 `search-string` 从远程平台查询：
- `product_id` 默认使用 `2`（CamScanner）
- **必须使用精确匹配**: `fuzzy: "0"`

### 第 3 步：用户确认

- 将结果整理为表格展示（版本、key、中文、英文、繁体）
- 无匹配结果 → 告知用户需要在多语言平台新增

### 第 4 步：写入本地 & 替换代码

1. 检查本地是否已有该 key
2. 如果没有：使用 `write-locales` 写入（`platform_id: "4"` Web 平台）
3. 替换代码中的硬编码字符串为 `$t('key_name')`
SKILL_EOF

# 注册插件
mkdir -p "$HOME/.claude/plugins"
if [ -f "$PLUGINS_JSON" ]; then
  if grep -q '"i18n@local"' "$PLUGINS_JSON" 2>/dev/null; then
    echo "  Plugin 已注册，跳过"
  else
    node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('$PLUGINS_JSON', 'utf-8'));
      data.plugins = data.plugins || {};
      data.plugins['i18n@local'] = [{
        scope: 'user',
        installPath: '$PLUGIN_DIR',
        version: '1.0.0',
        installedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      }];
      fs.writeFileSync('$PLUGINS_JSON', JSON.stringify(data, null, 2) + '\n');
    "
    echo "  Plugin 已注册"
  fi
else
  cat > "$PLUGINS_JSON" << EOF
{
  "version": 2,
  "plugins": {
    "i18n@local": [{
      "scope": "user",
      "installPath": "$PLUGIN_DIR",
      "version": "1.0.0",
      "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
      "lastUpdated": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
    }]
  }
}
EOF
  echo "  Plugin 已注册"
fi

# 启用插件
if [ -f "$SETTINGS_JSON" ]; then
  if grep -q '"i18n@local"' "$SETTINGS_JSON" 2>/dev/null; then
    echo "  Plugin 已启用"
  else
    node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('$SETTINGS_JSON', 'utf-8'));
      data.enabledPlugins = data.enabledPlugins || {};
      data.enabledPlugins['i18n@local'] = true;
      fs.writeFileSync('$SETTINGS_JSON', JSON.stringify(data, null, 2) + '\n');
    "
    echo "  Plugin 已启用"
  fi
fi

# ---- 完成 ----
echo ""
echo "==============================="
echo " 安装完成！请重启 Claude Code"
echo "==============================="
echo ""
echo "使用方式："
echo "  /i18n 下载          → 自动搜索+集成多语言字符串"
echo "  /i18n 扫描全能王     → 搜索指定字符串"
echo ""
echo "更新 Cookie（过期后）："
echo "  编辑 $MCP_SERVER_DIR/.cookie"
echo "  编辑 $MCP_SERVER_DIR/.csrf-token"
echo ""
