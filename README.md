# CamScanner i18n MCP Language Server

用于 Claude Code 的多语言字符串管理 MCP Server，支持从 CamScanner 运营平台搜索、导出、写入多语言字符串。

## 功能

| 工具 | 说明 |
|------|------|
| `search-string` | 按关键词搜索多语言字符串 |
| `export-string` | 导出为 cs-i18n 兼容的 locale JSON |
| `write-locales` | 将字符串直接写入项目 locales 目录 |
| `get-version-list` | 获取产品版本列表 |

## 安装

### 一键安装

```bash
git clone git@github.com:tianmuji/mcp-language-server.git ~/mcp-language-server
cd ~/mcp-language-server
bash setup.sh
```

安装脚本会自动完成：
1. 安装 npm 依赖
2. 交互式配置 Cookie 和 CSRF Token
3. 注册 MCP Server 到 `~/.claude/.mcp.json`
4. 安装 i18n Plugin（含 `/i18n` Skill）
5. 启用插件

安装完成后**重启 Claude Code** 即可使用。

### 手动安装

```bash
git clone git@github.com:tianmuji/mcp-language-server.git ~/mcp-language-server
cd ~/mcp-language-server
npm install
```

然后在 `~/.claude/.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "language": {
      "command": "node",
      "args": ["/Users/你的用户名/mcp-language-server/index.js"]
    }
  }
}
```

## 配置认证

MCP Server 通过 Cookie 访问运营平台 API，需要手动配置：

1. 浏览器打开 https://operate-test.intsig.net/multilanguage
2. 登录后打开 DevTools → Network
3. 做一次搜索操作，找到 `get-string-search` 请求
4. 从请求头中提取 Cookie 和 X-CSRF-Token

将值写入文件：

```bash
echo '你的cookie值' > ~/mcp-language-server/.cookie
echo '你的csrf-token值' > ~/mcp-language-server/.csrf-token
```

> Cookie 会过期，过期后重新执行上述步骤更新即可。

## 使用方式

在 Claude Code 中：

```
# 通过 /i18n skill 触发
/i18n 下载

# 搜索指定字符串
/i18n 扫描全能王

# 直接对话也会自动触发（提到「多语言」「i18n」「国际化」等关键词）
帮我把"下载"这个字符串集成到代码里
```

### 工作流程

1. **本地查找** — 先在项目 `src/locales/ZhCn.json` 中搜索是否已有该字符串
2. **远程查询** — 本地未找到时，调用 MCP Server 从运营平台精确搜索
3. **用户确认** — 展示搜索结果（版本、key、中文、英文、繁体）
4. **写入 & 替换** — 使用 `write-locales` 写入 locale 文件，替换代码中的硬编码字符串为 `$t('key')`

### 常用产品 ID

| ID | 产品 |
|----|------|
| 1 | CamCard |
| 2 | CamScanner |
| 44 | CamScanner Lite |
| 47 | CS PDF |
| 53 | CS Harmony |

## 项目结构

```
mcp-language-server/
├── index.js          # MCP Server 主文件
├── setup.sh          # 一键安装脚本
├── package.json
├── .cookie           # Cookie 认证文件（不提交）
├── .csrf-token       # CSRF Token 文件（不提交）
└── .gitignore
```

## 依赖

- Node.js >= 18
- Claude Code
- `@modelcontextprotocol/sdk`
