# CamScanner i18n MCP Language Server

用于 Claude Code 的多语言字符串管理 MCP Server，支持从 CamScanner 运营平台搜索、导出、写入多语言字符串。

## 功能

| 工具 | 说明 |
|------|------|
| `authenticate` | SSO 扫码登录 |
| `logout` | 退出登录，清除凭证 |
| `search-string` | 按关键词搜索多语言字符串 |
| `export-string` | 导出为 cs-i18n 兼容的 locale JSON |
| `write-locales` | 将字符串直接写入项目 locales 目录 |
| `get-version-list` | 获取产品版本列表 |

## 安装

### 方式一：插件安装（推荐）

```bash
# 1. 添加市场（仅首次）
claude plugin marketplace add tianmuji/camscanner-plugins

# 2. 安装插件
claude plugin install i18n@camscanner-plugins
```

插件安装后会自动注册 MCP Server 和 `/i18n` Skill。重启 Claude Code 即可使用。

### 方式二：手动配置 MCP

编辑 `~/.claude/.mcp.json`，在 `mcpServers` 中添加：

```json
{
  "mcpServers": {
    "language": {
      "command": "npx",
      "args": ["-y", "git+https://github.com/tianmuji/mcp-language-server.git"],
      "env": {
        "OPERATE_BASE_URL": "https://operate.intsig.net",
        "SSO_LOGIN_URL": "https://web-sso.intsig.net/login",
        "SSO_PLATFORM_ID": "OdliDeAnVtlUA5cGwwxZPHUyXtqPCcNw",
        "SSO_CALLBACK_DOMAIN": "https://www-sandbox.camscanner.com/activity/mcp-auth-callback",
        "SSO_CALLBACK_PORT": "9877"
      }
    }
  }
}
```

重启 Claude Code，无需克隆仓库，`npx` 会自动从 GitHub 下载并运行。

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

## 认证

首次使用时在 Claude Code 中调用 `authenticate` 工具，会自动打开浏览器进行 SSO 扫码登录。

- 认证信息保存在 `~/.language-mcp/credentials.json`
- 有效期 24 小时，过期后重新 `authenticate`

## 项目结构

```
mcp-language-server/
├── src/                        # TypeScript 源码
│   ├── index.ts                # MCP 入口 + 工具注册
│   ├── auth.ts                 # SSO 认证模块
│   ├── operate-client.ts       # 原生 HTTP 客户端
│   └── mcp-sso-auth.d.ts      # 类型声明
├── dist/                       # 编译产出（npx 运行入口）
│   ├── index.js
│   ├── auth.js
│   └── operate-client.js
├── plugins/
│   └── i18n/
│       ├── .claude-plugin/
│       │   └── plugin.json     # 插件元数据
│       ├── .mcp.json           # MCP Server 注册配置（npx 模式）
│       └── skills/
│           └── i18n/
│               └── SKILL.md    # /i18n Skill 定义
├── package.json
├── tsconfig.json
└── .gitignore
```

## 开发

```bash
git clone git@github.com:tianmuji/mcp-language-server.git
cd mcp-language-server
npm install
npm run build     # tsc 编译
npm start         # 运行 stdio 模式
```

## 依赖

- Node.js >= 18
- Claude Code
- `@modelcontextprotocol/sdk` — MCP 协议 SDK
- `mcp-sso-auth` — SSO 认证共享模块
- `zod` — 参数校验
