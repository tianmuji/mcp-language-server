# CamScanner i18n MCP Language Server

用于 Claude Code 的多语言字符串管理插件，支持从 CamScanner 运营平台搜索、导出、写入多语言字符串。

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
3. 安装 i18n Plugin（自动注册 MCP Server + `/i18n` Skill）

安装完成后**重启 Claude Code** 即可使用。

### 手动安装

#### 1. 克隆仓库 & 安装依赖

```bash
git clone git@github.com:tianmuji/mcp-language-server.git ~/mcp-language-server
cd ~/mcp-language-server
npm install
```

#### 2. 配置认证

浏览器打开 https://operate-test.intsig.net/multilanguage ，登录后打开 DevTools → Network，做一次搜索操作，找到 `get-string-search` 请求，从请求头中提取 Cookie 和 X-CSRF-Token：

```bash
echo '你的cookie值' > ~/mcp-language-server/.cookie
echo '你的csrf-token值' > ~/mcp-language-server/.csrf-token
```

> Cookie 一般一天后过期，过期后参考下方「更新 Cookie」章节。

#### 3. 安装插件

```bash
claude plugin marketplace add tianmuji/mcp-language-server --sparse plugins .claude-plugin
claude plugin install i18n
```

插件安装后会自动注册 MCP Server 和 `/i18n` Skill，无需手动编辑 `~/.claude/.mcp.json`。

#### 4. 重启 Claude Code

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

## 更新 Cookie

Cookie 一般一天后过期，过期后有两种方式更新：

### 方式一：传入 curl 命令（推荐）

浏览器 DevTools → Network → 右键请求 → Copy as cURL，然后：

```bash
bash ~/mcp-language-server/update-cookie.sh '粘贴整个curl命令'
```

脚本会自动从 curl 命令中提取 Cookie 和 CSRF Token。

### 方式二：手动输入

```bash
bash ~/mcp-language-server/update-cookie.sh
```

按提示粘贴 Cookie 和 X-CSRF-Token 值。

### 方式三：直接编辑文件

```bash
echo '新的cookie' > ~/mcp-language-server/.cookie
echo '新的csrf-token' > ~/mcp-language-server/.csrf-token
```

更新后**重启 Claude Code** 生效。

## 项目结构

```
mcp-language-server/
├── .claude-plugin/
│   └── marketplace.json    # Marketplace 配置
├── plugins/
│   └── i18n/
│       ├── .claude-plugin/
│       │   └── plugin.json # 插件元数据
│       ├── .mcp.json       # MCP Server 自动注册配置
│       └── skills/
│           └── i18n/
│               └── SKILL.md  # /i18n Skill 定义
├── index.js                # MCP Server 主文件
├── setup.sh                # 一键安装脚本
├── update-cookie.sh        # Cookie 快速更新脚本
├── package.json
├── .cookie                 # Cookie 认证文件（不提交）
├── .csrf-token             # CSRF Token 文件（不提交）
└── .gitignore
```

## 依赖

- Node.js >= 18
- Claude Code
- `@modelcontextprotocol/sdk`
