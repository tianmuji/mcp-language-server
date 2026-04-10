# CamScanner i18n MCP Language Server

用于 Claude Code 的多语言字符串管理 MCP Server，支持从 CamScanner 运营平台搜索、导出、写入多语言字符串。

## 功能

| 工具 | 说明 |
|------|------|
| `authenticate` | 浏览器登录运营平台 |
| `logout` | 退出登录，清除凭证 |
| `search-string` | 按关键词搜索多语言字符串 |
| `export-string` | 导出为 cs-i18n 兼容的 locale JSON |
| `write-locales` | 将字符串直接写入项目 locales 目录 |
| `get-version-list` | 获取产品版本列表 |

## 安装

```bash
# 1. 添加市场（仅首次）
claude plugin marketplace add tianmuji/camscanner-plugins

# 2. 安装插件
claude plugin install i18n@camscanner-plugins
```

安装后重启 Claude Code 即可使用。插件会自动注册 MCP Server 和 `/i18n` Skill。

### 前提条件

- Node.js >= 18
- Playwright Chromium（用于浏览器登录）：`npx playwright install chromium`

## 认证

首次使用时调用 `authenticate` 工具，会打开浏览器进行 SSO 登录（扫码验证 + 密码）。

- 浏览器数据持久化在 `~/.language-mcp/browser-data/`，保存的密码下次自动填充
- 认证信息保存在 `~/.language-mcp/credentials.json`，有效期 24 小时

## 常用产品 ID

| ID | 产品 |
|----|------|
| 1 | CamCard |
| 2 | CamScanner |
| 44 | CamScanner Lite |
| 47 | CS PDF |
| 53 | CS Harmony |
