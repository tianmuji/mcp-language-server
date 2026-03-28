#!/bin/bash
# CamScanner i18n MCP Server + Plugin 一键安装
# 用法: bash setup.sh
set -e

echo "=== CamScanner i18n 多语言工具安装 ==="
echo ""

# ---- 配置 ----
MCP_SERVER_DIR="$HOME/mcp-language-server"
MCP_JSON="$HOME/.claude/.mcp.json"

# ---- 1. 安装 MCP Server ----
echo "[1/4] 安装 MCP Language Server..."
if [ -d "$MCP_SERVER_DIR" ]; then
  echo "  目录已存在，更新中..."
  cd "$MCP_SERVER_DIR"
  git pull 2>/dev/null || echo "  非 git 仓库，跳过更新"
else
  echo "  克隆仓库..."
  git clone git@github.com:tianmuji/mcp-language-server.git "$MCP_SERVER_DIR"
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

# ---- 4. 安装 i18n Plugin (via marketplace) ----
echo ""
echo "[4/4] 安装 i18n Plugin..."

# 添加 marketplace
if claude plugin marketplace list 2>&1 | grep -q "camscanner-plugins"; then
  echo "  Marketplace 已注册，跳过"
else
  echo "  注册 marketplace..."
  claude plugin marketplace add tianmuji/mcp-language-server --sparse plugins .claude-plugin 2>&1
fi

# 安装插件
if claude plugin list 2>&1 | grep -q "i18n@camscanner-plugins"; then
  echo "  Plugin 已安装，跳过"
else
  echo "  安装插件..."
  claude plugin install i18n 2>&1
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
