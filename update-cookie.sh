#!/bin/bash
# 快速更新 Cookie 和 CSRF Token
# 用法: bash update-cookie.sh
#   或: bash update-cookie.sh "从浏览器复制的完整 curl 命令"

MCP_SERVER_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== 更新多语言平台认证信息 ==="
echo ""

# 如果传入了 curl 命令，自动提取 cookie 和 csrf token
if [ -n "$1" ]; then
  CURL_CMD="$*"

  # 从 curl 命令中提取 cookie (-b 或 --cookie 或 -H 'cookie: ...')
  COOKIE=$(echo "$CURL_CMD" | grep -oP "(?<=-b ').*?(?=')" 2>/dev/null || \
           echo "$CURL_CMD" | sed -n "s/.*-b '\([^']*\)'.*/\1/p" 2>/dev/null || \
           echo "$CURL_CMD" | sed -n "s/.*-b \"\([^\"]*\)\".*/\1/p" 2>/dev/null)

  if [ -z "$COOKIE" ]; then
    COOKIE=$(echo "$CURL_CMD" | sed -n "s/.*[Cc]ookie: \([^'\"]*\)['\"].*/\1/p" 2>/dev/null)
  fi

  # 从 curl 命令中提取 csrf token
  CSRF=$(echo "$CURL_CMD" | sed -n "s/.*[Xx]-[Cc][Ss][Rr][Ff]-[Tt]oken: \([^'\"]*\)['\"].*/\1/p" 2>/dev/null)

  if [ -n "$COOKIE" ]; then
    echo "$COOKIE" > "$MCP_SERVER_DIR/.cookie"
    echo "Cookie 已更新 (${#COOKIE} 字符)"
  else
    echo "未能从 curl 命令中提取 Cookie，请手动输入"
  fi

  if [ -n "$CSRF" ]; then
    echo "$CSRF" > "$MCP_SERVER_DIR/.csrf-token"
    echo "CSRF Token 已更新"
  else
    echo "未能从 curl 命令中提取 CSRF Token，请手动输入"
  fi

  if [ -n "$COOKIE" ] && [ -n "$CSRF" ]; then
    echo ""
    echo "更新完成！请重启 Claude Code 使其生效。"
    exit 0
  fi
  echo ""
fi

# 交互式输入
echo "获取方式："
echo "  1. 浏览器打开 https://operate-test.intsig.net/multilanguage"
echo "  2. 登录后打开 DevTools → Network"
echo "  3. 做一次搜索操作，找到 get-string-search 请求"
echo "  4. 右键 → Copy → Copy as cURL"
echo ""

if [ -z "$COOKIE" ]; then
  read -p "粘贴 Cookie 值: " COOKIE
  if [ -n "$COOKIE" ]; then
    echo "$COOKIE" > "$MCP_SERVER_DIR/.cookie"
    echo "Cookie 已保存 (${#COOKIE} 字符)"
  fi
fi

if [ -z "$CSRF" ]; then
  echo ""
  read -p "粘贴 X-CSRF-Token 值: " CSRF
  if [ -n "$CSRF" ]; then
    echo "$CSRF" > "$MCP_SERVER_DIR/.csrf-token"
    echo "CSRF Token 已保存"
  fi
fi

echo ""
echo "更新完成！请重启 Claude Code 使其生效。"
