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

## 使用示例

```
> 帮我集成「删除文档」的多语言
> 搜索 cs_519b 开头的所有 key
> 将 cs_xxx_1 写入项目的 locales 目录
```

## 注意事项

- **禁止手动编辑 locale JSON 文件**，所有写入操作必须通过 `write-locales` 工具完成
- 带参数的字符串（如 `已选择{0}条`）建议用 key 名搜索，不要用中文值精确搜索
- 不同产品和平台的字符串 key 可能不同，使用前先确认 product_id 和 platform_id

## 开发者指南

### 发布新版本

```bash
# 1. 修改代码并构建
npm run build

# 2. 更新版本号并发布到 npm
npm version patch   # bug fix: 1.0.0 → 1.0.1
npm version minor   # 新功能: 1.0.0 → 1.1.0
npm version major   # 破坏性变更: 1.0.0 → 2.0.0

npm publish --registry https://registry.npmjs.org/ --access public

# 3. 推送 tag 到远端
git push && git push --tags
```

用户下次启动 Claude Code 时，`npx -y @camscanner/mcp-language-server@latest` 会自动拉取新版本。

## 常用产品 ID

| ID | 产品 |
|----|------|
| 1 | CamCard |
| 2 | CamScanner |
| 44 | CamScanner Lite |
| 47 | CS PDF |
| 53 | CS Harmony |
