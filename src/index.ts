#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v3'
import fs from 'fs'
import path from 'path'
import { OperateClient } from './operate-client.js'
import { loadCredentials, saveCredentials, clearCredentials, startSsoLogin } from './auth.js'
import type { OperateCredentials } from './operate-client.js'
import { PLATFORM_MAP, LANGUAGE_LOCALE_MAP, fixPlaceholders, extractStrings, mergeLocaleEntries, findMissingLocales } from './utils.js'

// --- Config from env ---
const OPERATE_BASE_URL = process.env.OPERATE_BASE_URL

if (!OPERATE_BASE_URL) {
  console.error('Error: OPERATE_BASE_URL environment variable is required')
  process.exit(1)
}

const ssoConfig = {
  operateBaseUrl: OPERATE_BASE_URL,
}

const client = new OperateClient(OPERATE_BASE_URL)


// --- Auth helper ---

async function requireAuth(): Promise<string | null> {
  if (!client.isAuthenticated()) {
    const savedCreds = await loadCredentials()
    if (savedCreds) {
      client.setCredentials(savedCreds)
      console.error('Restored saved credentials (valid until ' + new Date(savedCreds.expiresAt).toLocaleString() + ')')
    }
  }
  if (!client.isAuthenticated()) {
    return "Not authenticated. Please call the 'authenticate' tool first to login via SSO."
  }
  return null
}

// --- MCP Server ---

const server = new McpServer({
  name: 'language-server',
  version: '1.0.0',
}, {
  instructions: `# 多语言字符串集成助手

帮助用户查询、集成多语言字符串到项目代码中。支持多个产品、多个平台、多种业务线。

## 可用 MCP 工具

1. **list-products** — 查询所有产品列表（产品名 → product_id）
2. **list-platforms** — 查询所有平台列表（平台名 → platform_id）
3. **get-version-list** — 获取指定产品的版本列表
4. **search-string** — 按关键词搜索多语言字符串（远程多语言平台）
5. **export-string** — 导出为兼容 cs-i18n 的 locale JSON 格式
6. **write-locales** — 将字符串写入项目的 locales 目录
7. **batch-search-string** — 批量搜索多个字符串
8. **list-version-strings** — 获取指定版本下的所有字符串

## 产品与平台

> **不要硬编码产品或平台 ID。** 使用 list-products 和 list-platforms 工具动态查询。
> 不同产品和平台的字符串 key 可能不同。同一条字符串在 Android/iOS/Web 上可能有不同的 key 名称。

## 核心原则

1. **不假设任何项目配置** — 不要硬编码 product_id、platform_id 或 locale 路径
2. **先了解再实现** — 先检测项目环境，再操作
3. **不确定就问** — 产品、平台、版本不确定时，询问用户
4. **禁止手动修改 locales 文件** — 绝对不允许使用 Edit、Write 等工具直接修改 locales 目录下的任何文件（如 ZhCn.json、EnUs.json、zh-CN.json 等语言文件）。所有对 locale 文件的写入操作**必须且只能**通过 write-locales MCP 工具完成。这是为了确保多语言字符串的一致性和可追溯性。

## 工作流程

### 第 0 步：确认产品与平台

如果用户没有明确指定产品和平台：

1. 调用 **list-products** 获取产品列表，展示给用户选择
2. 调用 **list-platforms** 获取平台列表，让用户确认目标平台
3. 如果用户已在之前的对话中指定过，或项目 CLAUDE.md 中有记录，则直接使用

记住用户选择的 product_id 和 platform_id，在后续步骤中使用。

### 第 1 步：检测项目多语言目录

**不要假设多语言文件在 src/locales/**。需要动态检测当前项目的 locale 目录：

1. **查找 i18n 配置** — 搜索项目中的 i18n 配置文件（如 i18n.ts、i18n.js、vue.config.* 等），确认 locale 文件路径
2. **搜索 locale 文件** — 使用 Glob 搜索 **/{locales,locale,lang,i18n}/*.json 或类似模式
3. **验证目录结构** — 确认找到的目录包含语言 JSON 文件（如 ZhCn.json、EnUs.json、zh-CN.json 等）
4. **确认主参考文件** — 找到中文语言文件作为本地搜索的参考

如果找不到或有多个候选目录，**询问用户确认**。

将检测到的路径记为 LOCALES_DIR，后续步骤使用。

### 第 2 步：了解现有实现

1. **阅读用户指定的组件/页面代码**，理解当前的 i18n 用法和代码风格
2. 查看同模块中已有的 $t() / t() / i18n.t() 等调用，确认命名模式和使用惯例
3. 确认项目使用的 i18n 框架和参数占位符格式（{0} / {name} / %s 等）

### 第 3 步：本地查找（优先）

先在项目本地 locale 文件中搜索，检查是否已存在匹配的字符串：

1. 使用 **Grep 工具**在中文语言文件中搜索用户提供的中文字符串
2. **严格匹配规则**: value 必须与用户需要的字符串**完全一致**
3. 如果本地找到了完全匹配的 key → **直接使用该 key，跳到第 5 步**

### 第 4 步：远程查询（本地未找到时）

使用 search-string 从远程平台查询：

- product_id 使用第 0 步确认的值
- **必须使用精确匹配**: fuzzy: "0"
- 将结果整理为表格展示（版本、key、中文、英文、繁体）
- 无匹配结果 → 告知用户需要在多语言平台新增

#### 搜索策略优先级

精确匹配同时匹配 key 名和中文值。按以下优先级搜索：

1. **按 key 名搜索**（最可靠）— 如果已知 key 名，直接用 key 名精确搜索
2. **按中文值精确搜索** — 适用于不带参数的简单字符串
3. **模糊搜索 + 人工确认** — 上述方式无结果时的兜底方案

#### 带参数字符串的注意事项

远程平台的占位符格式不统一，同一字符串在不同版本中可能是 %s、%d、{0}，空格也可能不一致。
因此**带参数的字符串不要用中文值精确搜索**，应该用 key 名搜索。如果不知道 key 名：
1. 先用模糊搜索 (fuzzy: "1") 定位候选结果
2. 从结果中确认正确的 key 名
3. 再用 key 名精确搜索获取完整翻译

### 第 5 步：写入本地 & 替换代码

> **禁止使用 Edit / Write 工具修改 locales 目录下的任何文件。必须使用 write-locales 工具写入。**

1. 检查本地是否已有该 key
2. 如果没有：使用 write-locales 写入（**这是唯一允许的写入方式**）
   - locales_path 使用第 1 步检测到的 LOCALES_DIR **绝对路径**
   - product_id 使用第 0 步确认的值
   - platform_id 使用第 0 步确认的值
   - **默认精确匹配** (fuzzy: "0")
   - 搜索词优先使用 **key 名**（尤其是带参数的字符串）
3. 替换代码中的硬编码字符串为 i18n 调用，**遵循第 2 步中了解到的现有代码风格**
4. **永远不要**手动编辑 locale JSON 文件来添加、删除或修改翻译 key`,
})

// Tool: authenticate
server.tool(
  'authenticate',
  'Login to operate platform via SSO QR code scan. Opens browser for authentication.',
  {},
  async () => {
    if (client.isAuthenticated()) {
      return { content: [{ type: 'text', text: "Already authenticated. Use 'logout' tool to re-authenticate." }] }
    }
    try {
      const creds = await startSsoLogin(ssoConfig)
      client.setCredentials(creds)
      await saveCredentials(creds)
      return { content: [{ type: 'text', text: 'Authentication successful! You can now use all language tools.' }] }
    } catch (err: any) {
      if (err.message?.includes('pre-verification')) {
        return {
          content: [{
            type: 'text',
            text: 'SSO pre-verification completed (no token returned yet). ' +
              'Please call \'authenticate\' again immediately to complete authentication.',
          }],
        }
      }
      return { content: [{ type: 'text', text: `Authentication failed: ${err.message}` }] }
    }
  }
)

// Tool: logout
server.tool(
  'logout',
  'Clear saved credentials and logout.',
  {},
  async () => {
    await clearCredentials()
    client.setCredentials(null)
    return { content: [{ type: 'text', text: "Logged out. Call 'authenticate' to login again." }] }
  }
)

// Tool: list-products
server.tool(
  'list-products',
  '获取多语言平台的所有产品列表。返回产品名称和对应的 product_id。在不确定 product_id 时先调用此工具。',
  {},
  async () => {
    const authErr = await requireAuth()
    if (authErr) return { content: [{ type: 'text', text: authErr }] }

    const data = await client.post('/common/product/get-product-list', {})
    if (data.errno !== 0) {
      return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] }
    }

    const products = data.data || {}
    let output = '产品列表:\n\n'
    output += '| product_id | 产品名称 |\n|---|---|\n'
    for (const [name, id] of Object.entries(products)) {
      output += `| ${id} | ${name} |\n`
    }
    return { content: [{ type: 'text', text: output }] }
  }
)

// Tool: list-platforms
server.tool(
  'list-platforms',
  '获取多语言平台支持的所有平台列表。返回平台名称和对应的 platform_id。',
  {},
  async () => {
    let output = '平台列表:\n\n'
    output += '| platform_id | 平台名称 |\n|---|---|\n'
    for (const [id, name] of Object.entries(PLATFORM_MAP)) {
      output += `| ${id} | ${name} |\n`
    }
    return { content: [{ type: 'text', text: output }] }
  }
)

// Tool: get-version-list
server.tool(
  'get-version-list',
  '获取指定产品的多语言版本列表。返回每个版本的 version_id、版本号、支持的平台和语言。',
  {
    product_id: z.string().describe('产品ID,先调用 list-products 查询'),
  },
  async ({ product_id }) => {
    const authErr = await requireAuth()
    if (authErr) return { content: [{ type: 'text', text: authErr }] }

    const data = await client.post('/language/mcp-language/get-version-list', { product_id })
    if (data.errno !== 0) {
      return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] }
    }

    const list = data.data.list || []
    const summary = list
      .map((v: any) => {
        const platformNames = (v.platforms || '').split(',').filter(Boolean)
          .map((id: string) => PLATFORM_MAP[Number(id)] || `unknown(${id})`).join(', ')
        return `- version_id=${v.version_id}, version=${v.version_number}, platforms=[${platformNames}], languages=${v.supported_languages}`
      })
      .join('\n')
    return { content: [{ type: 'text', text: `共 ${data.data.total} 个版本:\n${summary}` }] }
  }
)

// Tool: search-string
server.tool(
  'search-string',
  '按关键词搜索多语言字符串。可指定版本精准搜索,返回 string_id、key、中英文翻译等信息。',
  {
    product_id: z.string().describe(
      '产品ID,先调用 list-products 查询'
    ),
    word: z.string().describe('搜索关键词(中文或英文)'),
    version_id: z.string().optional().describe('版本ID,不传则搜索所有版本'),
    fuzzy: z.string().optional().default('1').describe('1=模糊匹配,0=精确匹配'),
    page: z.string().optional().default('1').describe('页码'),
    page_size: z.string().optional().default('20').describe('每页条数,最大100'),
  },
  async ({ product_id, word, version_id, fuzzy, page, page_size }) => {
    const authErr = await requireAuth()
    if (authErr) return { content: [{ type: 'text', text: authErr }] }

    const params: Record<string, string> = { product_id, word, fuzzy: fuzzy || '1', page: page || '1', page_size: page_size || '20' }
    if (version_id) params.version_id = version_id

    const data = await client.post('/language/mcp-language/get-string-search', params)
    if (data.errno !== 0) {
      return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] }
    }

    const versions = Array.isArray(data.data) ? data.data : (data.data?.list || [])
    if (versions.length === 0) {
      return { content: [{ type: 'text', text: `未找到匹配 "${word}" 的字符串` }] }
    }

    let output = `共 ${versions.length} 个版本有匹配结果:\n\n`
    for (const version of versions) {
      output += `## 版本 ${version.version_number} (version_id=${version.version_id})\n`
      const strings = version.ar_string || version.strings || []
      for (const str of strings) {
        const keys = str.keys
          ? Object.entries(str.keys).map(([p, k]) => `platform_${p}: ${k}`).join(', ')
          : '无'
        const zhCN = str.values?.['1'] || str.values?.['0'] || ''
        const enUS = str.values?.['2'] || str.values?.['0'] || ''
        const zhTW = str.values?.['7'] || ''
        output += `- string_id: ${str.id}\n`
        output += `  key: ${keys}\n`
        output += `  中文: ${zhCN}\n`
        output += `  英文: ${enUS}\n`
        if (zhTW) output += `  繁体: ${zhTW}\n`
        output += '\n'
      }
    }
    return { content: [{ type: 'text', text: output }] }
  }
)

// Tool: export-string
server.tool(
  'export-string',
  '搜索多语言字符串并导出为兼容 cs-i18n 的 locale JSON 格式。支持单语言或全部语言导出,自动将 %s 替换为 {0}/{1}/{2}。',
  {
    product_id: z.string().describe(
      '产品ID。常用: 1=CamCard, 2=CamScanner, 44=CS Lite, 47=CS PDF, 53=CS Harmony'
    ),
    word: z.string().describe('搜索关键词(中文或英文)'),
    version_id: z.string().optional().describe('版本ID,不传则搜索所有版本'),
    platform_id: z.string().optional().default('4').describe(
      '平台ID,先调用 list-platforms 查询。默认4=Web'
    ),
    language_id: z.string().optional().describe('目标语言ID,不传则导出所有语言。常用: 1=中文, 2=英文, 7=繁体中文'),
    fuzzy: z.string().optional().default('0').describe('0=精确匹配(默认,只导出完全一致的字符串), 1=模糊匹配'),
  },
  async ({ product_id, word, version_id, platform_id, language_id, fuzzy }) => {
    const authErr = await requireAuth()
    if (authErr) return { content: [{ type: 'text', text: authErr }] }

    const params: Record<string, string> = { product_id, word, fuzzy: fuzzy || '0', page: '1', page_size: '100' }
    if (version_id) params.version_id = version_id

    const data = await client.post('/language/mcp-language/get-string-search', params)
    if (data.errno !== 0) {
      return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] }
    }

    const versions = Array.isArray(data.data) ? data.data : (data.data?.list || [])
    if (versions.length === 0) {
      return { content: [{ type: 'text', text: `未找到匹配 "${word}" 的字符串` }] }
    }

    const allStrings = extractStrings(versions, platform_id || '4')

    if (language_id) {
      const localeObj = allStrings[language_id] || {}
      if (Object.keys(localeObj).length === 0) {
        return { content: [{ type: 'text', text: `找到字符串但语言ID=${language_id} 无翻译内容` }] }
      }
      const localeName = LANGUAGE_LOCALE_MAP[language_id] || `lang_${language_id}`
      const json = JSON.stringify(localeObj, null, 2)
      return {
        content: [{
          type: 'text',
          text: `导出 ${Object.keys(localeObj).length} 条字符串 → ${localeName}.json:\n\n\`\`\`json\n${json}\n\`\`\``,
        }],
      }
    }

    let output = `共匹配 ${Object.keys(allStrings).length} 种语言:\n\n`
    for (const [langId, localeObj] of Object.entries(allStrings)) {
      const localeName = LANGUAGE_LOCALE_MAP[langId] || `lang_${langId}`
      const json = JSON.stringify(localeObj, null, 2)
      output += `### ${localeName}.json (语言ID=${langId}, ${Object.keys(localeObj).length} 条)\n\`\`\`json\n${json}\n\`\`\`\n\n`
    }
    return { content: [{ type: 'text', text: output }] }
  }
)

// Tool: write-locales
server.tool(
  'write-locales',
  '搜索多语言字符串并直接写入项目的 locales 目录,兼容 cs-i18n 工具格式。自动合并到已有的 locale JSON 文件,%s 自动替换为 {0}/{1}/{2}。',
  {
    product_id: z.string().describe(
      '产品ID。常用: 1=CamCard, 2=CamScanner, 44=CS Lite, 47=CS PDF, 53=CS Harmony'
    ),
    word: z.string().describe('搜索关键词(中文或英文)'),
    locales_path: z.string().describe('locales 目录的绝对路径（需动态检测，不要硬编码）'),
    version_id: z.string().optional().describe('版本ID,不传则搜索所有版本'),
    platform_id: z.string().optional().default('4').describe(
      '平台ID,先调用 list-platforms 查询。默认4=Web'
    ),
    fuzzy: z.string().optional().default('0').describe('0=精确匹配(默认,只写入完全一致的字符串), 1=模糊匹配'),
  },
  async ({ product_id, word, locales_path, version_id, platform_id, fuzzy }) => {
    const authErr = await requireAuth()
    if (authErr) return { content: [{ type: 'text', text: authErr }] }

    if (!fs.existsSync(locales_path)) {
      return { content: [{ type: 'text', text: `错误: locales 目录不存在: ${locales_path}` }] }
    }

    const params: Record<string, string> = { product_id, word, fuzzy: fuzzy || '0', page: '1', page_size: '100' }
    if (version_id) params.version_id = version_id

    const data = await client.post('/language/mcp-language/get-string-search', params)
    if (data.errno !== 0) {
      return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] }
    }

    const versions = Array.isArray(data.data) ? data.data : (data.data?.list || [])
    if (versions.length === 0) {
      return { content: [{ type: 'text', text: `未找到匹配 "${word}" 的字符串` }] }
    }

    const allStrings = extractStrings(versions, platform_id || '4')

    const results: string[] = []
    let totalKeys = 0
    let filesWritten = 0
    let filesSkipped = 0

    for (const [langId, newEntries] of Object.entries(allStrings)) {
      const localeName = LANGUAGE_LOCALE_MAP[langId]
      if (!localeName) { filesSkipped++; continue }

      const filePath = path.join(locales_path, `${localeName}.json`)
      if (!fs.existsSync(filePath)) { filesSkipped++; continue }

      let existingObj: Record<string, string> = {}
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        existingObj = JSON.parse(content)
      } catch {
        // empty or invalid file
      }

      const { merged, keysAdded, keysUpdated } = mergeLocaleEntries(existingObj, newEntries)

      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n')
      filesWritten++
      totalKeys += Object.keys(newEntries).length
      if (keysAdded.length > 0 || keysUpdated.length > 0) {
        results.push(`${localeName}.json: +${keysAdded.length} 新增, ~${keysUpdated.length} 更新`)
      } else {
        results.push(`${localeName}.json: 无变化 (${Object.keys(newEntries).length} 条已存在)`)
      }
    }

    // Detect local locale files that got no remote data
    const localLocaleNames = fs.readdirSync(locales_path)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
    const missingLocales = findMissingLocales(localLocaleNames, Object.keys(allStrings))

    let output = `写入完成!\n`
    output += `- 目录: ${locales_path}\n`
    output += `- 写入 ${filesWritten} 个文件, 跳过 ${filesSkipped} 个 (项目中不存在)\n`
    output += `- 共 ${totalKeys} 条字符串\n\n`
    output += results.map(r => `  ${r}`).join('\n')

    if (missingLocales.length > 0) {
      output += `\n\n⚠️ 以下 ${missingLocales.length} 个本地语言文件未获得远程翻译，未被更新:\n`
      output += missingLocales.map(name => `  - ${name}.json`).join('\n')
      output += `\n请确认远程平台是否已为这些语言提供翻译。`
    }

    return { content: [{ type: 'text', text: output }] }
  }
)

// --- Start ---
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Language MCP Server running on stdio')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
