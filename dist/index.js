#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const v3_1 = require("zod/v3");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const operate_client_js_1 = require("./operate-client.js");
const auth_js_1 = require("./auth.js");
const utils_js_1 = require("./utils.js");
// --- Config from env ---
const OPERATE_BASE_URL = process.env.OPERATE_BASE_URL;
if (!OPERATE_BASE_URL) {
    console.error('Error: OPERATE_BASE_URL environment variable is required');
    process.exit(1);
}
const ssoConfig = {
    operateBaseUrl: OPERATE_BASE_URL,
};
const client = new operate_client_js_1.OperateClient(OPERATE_BASE_URL);
// --- Auth helper ---
async function requireAuth() {
    if (!client.isAuthenticated()) {
        const savedCreds = await (0, auth_js_1.loadCredentials)();
        if (savedCreds) {
            client.setCredentials(savedCreds);
            console.error('Restored saved credentials (valid until ' + new Date(savedCreds.expiresAt).toLocaleString() + ')');
        }
    }
    if (!client.isAuthenticated()) {
        return "Not authenticated. Please call the 'authenticate' tool first to login via SSO.";
    }
    return null;
}
// --- MCP Server ---
const server = new mcp_js_1.McpServer({
    name: 'language-server',
    version: '1.0.0',
});
// Tool: authenticate
server.tool('authenticate', 'Login to operate platform via SSO QR code scan. Opens browser for authentication.', {}, async () => {
    if (client.isAuthenticated()) {
        return { content: [{ type: 'text', text: "Already authenticated. Use 'logout' tool to re-authenticate." }] };
    }
    try {
        const creds = await (0, auth_js_1.startSsoLogin)(ssoConfig);
        client.setCredentials(creds);
        await (0, auth_js_1.saveCredentials)(creds);
        return { content: [{ type: 'text', text: 'Authentication successful! You can now use all language tools.' }] };
    }
    catch (err) {
        if (err.message?.includes('pre-verification')) {
            return {
                content: [{
                        type: 'text',
                        text: 'SSO pre-verification completed (no token returned yet). ' +
                            'Please call \'authenticate\' again immediately to complete authentication.',
                    }],
            };
        }
        return { content: [{ type: 'text', text: `Authentication failed: ${err.message}` }] };
    }
});
// Tool: logout
server.tool('logout', 'Clear saved credentials and logout.', {}, async () => {
    await (0, auth_js_1.clearCredentials)();
    client.setCredentials(null);
    return { content: [{ type: 'text', text: "Logged out. Call 'authenticate' to login again." }] };
});
// Tool: list-products
server.tool('list-products', '获取多语言平台的所有产品列表。返回产品名称和对应的 product_id。在不确定 product_id 时先调用此工具。', {}, async () => {
    const authErr = await requireAuth();
    if (authErr)
        return { content: [{ type: 'text', text: authErr }] };
    const data = await client.post('/common/product/get-product-list', {});
    if (data.errno !== 0) {
        return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] };
    }
    const products = data.data || {};
    let output = '产品列表:\n\n';
    output += '| product_id | 产品名称 |\n|---|---|\n';
    for (const [name, id] of Object.entries(products)) {
        output += `| ${id} | ${name} |\n`;
    }
    return { content: [{ type: 'text', text: output }] };
});
// Tool: list-platforms
server.tool('list-platforms', '获取多语言平台支持的所有平台列表。返回平台名称和对应的 platform_id。', {}, async () => {
    let output = '平台列表:\n\n';
    output += '| platform_id | 平台名称 |\n|---|---|\n';
    for (const [id, name] of Object.entries(utils_js_1.PLATFORM_MAP)) {
        output += `| ${id} | ${name} |\n`;
    }
    return { content: [{ type: 'text', text: output }] };
});
// Tool: get-version-list
server.tool('get-version-list', '获取指定产品的多语言版本列表。返回每个版本的 version_id、版本号、支持的平台和语言。', {
    product_id: v3_1.z.string().describe('产品ID,先调用 list-products 查询'),
}, async ({ product_id }) => {
    const authErr = await requireAuth();
    if (authErr)
        return { content: [{ type: 'text', text: authErr }] };
    const data = await client.post('/language/language/get-version-list', { product_id });
    if (data.errno !== 0) {
        return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] };
    }
    const list = data.data.list || [];
    const summary = list
        .map((v) => {
        const platformNames = (v.platforms || '').split(',').filter(Boolean)
            .map((id) => utils_js_1.PLATFORM_MAP[Number(id)] || `unknown(${id})`).join(', ');
        return `- version_id=${v.version_id}, version=${v.version_number}, platforms=[${platformNames}], languages=${v.supported_languages}`;
    })
        .join('\n');
    return { content: [{ type: 'text', text: `共 ${data.data.total} 个版本:\n${summary}` }] };
});
// Tool: search-string
server.tool('search-string', '按关键词搜索多语言字符串。可指定版本精准搜索,返回 string_id、key、中英文翻译等信息。', {
    product_id: v3_1.z.string().describe('产品ID,先调用 list-products 查询'),
    word: v3_1.z.string().describe('搜索关键词(中文或英文)'),
    version_id: v3_1.z.string().optional().describe('版本ID,不传则搜索所有版本'),
    fuzzy: v3_1.z.string().optional().default('1').describe('1=模糊匹配,0=精确匹配'),
    page: v3_1.z.string().optional().default('1').describe('页码'),
    page_size: v3_1.z.string().optional().default('20').describe('每页条数,最大100'),
}, async ({ product_id, word, version_id, fuzzy, page, page_size }) => {
    const authErr = await requireAuth();
    if (authErr)
        return { content: [{ type: 'text', text: authErr }] };
    const params = { product_id, word, fuzzy: fuzzy || '1', page: page || '1', page_size: page_size || '20' };
    if (version_id)
        params.version_id = version_id;
    const data = await client.post('/language/language/get-string-search', params);
    if (data.errno !== 0) {
        return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] };
    }
    const versions = Array.isArray(data.data) ? data.data : (data.data?.list || []);
    if (versions.length === 0) {
        return { content: [{ type: 'text', text: `未找到匹配 "${word}" 的字符串` }] };
    }
    let output = `共 ${versions.length} 个版本有匹配结果:\n\n`;
    for (const version of versions) {
        output += `## 版本 ${version.version_number} (version_id=${version.version_id})\n`;
        const strings = version.ar_string || version.strings || [];
        for (const str of strings) {
            const keys = str.keys
                ? Object.entries(str.keys).map(([p, k]) => `platform_${p}: ${k}`).join(', ')
                : '无';
            const zhCN = str.values?.['1'] || str.values?.['0'] || '';
            const enUS = str.values?.['2'] || str.values?.['0'] || '';
            const zhTW = str.values?.['7'] || '';
            output += `- string_id: ${str.id}\n`;
            output += `  key: ${keys}\n`;
            output += `  中文: ${zhCN}\n`;
            output += `  英文: ${enUS}\n`;
            if (zhTW)
                output += `  繁体: ${zhTW}\n`;
            output += '\n';
        }
    }
    return { content: [{ type: 'text', text: output }] };
});
// Tool: export-string
server.tool('export-string', '搜索多语言字符串并导出为兼容 cs-i18n 的 locale JSON 格式。支持单语言或全部语言导出,自动将 %s 替换为 {0}/{1}/{2}。', {
    product_id: v3_1.z.string().describe('产品ID。常用: 1=CamCard, 2=CamScanner, 44=CS Lite, 47=CS PDF, 53=CS Harmony'),
    word: v3_1.z.string().describe('搜索关键词(中文或英文)'),
    version_id: v3_1.z.string().optional().describe('版本ID,不传则搜索所有版本'),
    platform_id: v3_1.z.string().optional().default('4').describe('平台ID,先调用 list-platforms 查询。默认4=Web'),
    language_id: v3_1.z.string().optional().describe('目标语言ID,不传则导出所有语言。常用: 1=中文, 2=英文, 7=繁体中文'),
}, async ({ product_id, word, version_id, platform_id, language_id }) => {
    const authErr = await requireAuth();
    if (authErr)
        return { content: [{ type: 'text', text: authErr }] };
    const params = { product_id, word, fuzzy: '1', page: '1', page_size: '100' };
    if (version_id)
        params.version_id = version_id;
    const data = await client.post('/language/language/get-string-search', params);
    if (data.errno !== 0) {
        return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] };
    }
    const versions = Array.isArray(data.data) ? data.data : (data.data?.list || []);
    if (versions.length === 0) {
        return { content: [{ type: 'text', text: `未找到匹配 "${word}" 的字符串` }] };
    }
    const allStrings = (0, utils_js_1.extractStrings)(versions, platform_id || '4');
    if (language_id) {
        const localeObj = allStrings[language_id] || {};
        if (Object.keys(localeObj).length === 0) {
            return { content: [{ type: 'text', text: `找到字符串但语言ID=${language_id} 无翻译内容` }] };
        }
        const localeName = utils_js_1.LANGUAGE_LOCALE_MAP[language_id] || `lang_${language_id}`;
        const json = JSON.stringify(localeObj, null, 2);
        return {
            content: [{
                    type: 'text',
                    text: `导出 ${Object.keys(localeObj).length} 条字符串 → ${localeName}.json:\n\n\`\`\`json\n${json}\n\`\`\``,
                }],
        };
    }
    let output = `共匹配 ${Object.keys(allStrings).length} 种语言:\n\n`;
    for (const [langId, localeObj] of Object.entries(allStrings)) {
        const localeName = utils_js_1.LANGUAGE_LOCALE_MAP[langId] || `lang_${langId}`;
        const json = JSON.stringify(localeObj, null, 2);
        output += `### ${localeName}.json (语言ID=${langId}, ${Object.keys(localeObj).length} 条)\n\`\`\`json\n${json}\n\`\`\`\n\n`;
    }
    return { content: [{ type: 'text', text: output }] };
});
// Tool: write-locales
server.tool('write-locales', '搜索多语言字符串并直接写入项目的 locales 目录,兼容 cs-i18n 工具格式。自动合并到已有的 locale JSON 文件,%s 自动替换为 {0}/{1}/{2}。', {
    product_id: v3_1.z.string().describe('产品ID。常用: 1=CamCard, 2=CamScanner, 44=CS Lite, 47=CS PDF, 53=CS Harmony'),
    word: v3_1.z.string().describe('搜索关键词(中文或英文)'),
    locales_path: v3_1.z.string().describe('locales 目录的绝对路径（需动态检测，不要硬编码）'),
    version_id: v3_1.z.string().optional().describe('版本ID,不传则搜索所有版本'),
    platform_id: v3_1.z.string().optional().default('4').describe('平台ID,先调用 list-platforms 查询。默认4=Web'),
}, async ({ product_id, word, locales_path, version_id, platform_id }) => {
    const authErr = await requireAuth();
    if (authErr)
        return { content: [{ type: 'text', text: authErr }] };
    if (!fs_1.default.existsSync(locales_path)) {
        return { content: [{ type: 'text', text: `错误: locales 目录不存在: ${locales_path}` }] };
    }
    const params = { product_id, word, fuzzy: '1', page: '1', page_size: '100' };
    if (version_id)
        params.version_id = version_id;
    const data = await client.post('/language/language/get-string-search', params);
    if (data.errno !== 0) {
        return { content: [{ type: 'text', text: `错误: ${data.message || JSON.stringify(data)}` }] };
    }
    const versions = Array.isArray(data.data) ? data.data : (data.data?.list || []);
    if (versions.length === 0) {
        return { content: [{ type: 'text', text: `未找到匹配 "${word}" 的字符串` }] };
    }
    const allStrings = (0, utils_js_1.extractStrings)(versions, platform_id || '4');
    const results = [];
    let totalKeys = 0;
    let filesWritten = 0;
    let filesSkipped = 0;
    for (const [langId, newEntries] of Object.entries(allStrings)) {
        const localeName = utils_js_1.LANGUAGE_LOCALE_MAP[langId];
        if (!localeName) {
            filesSkipped++;
            continue;
        }
        const filePath = path_1.default.join(locales_path, `${localeName}.json`);
        if (!fs_1.default.existsSync(filePath)) {
            filesSkipped++;
            continue;
        }
        let existingObj = {};
        try {
            const content = fs_1.default.readFileSync(filePath, 'utf-8');
            existingObj = JSON.parse(content);
        }
        catch {
            // empty or invalid file
        }
        const { merged, keysAdded, keysUpdated } = (0, utils_js_1.mergeLocaleEntries)(existingObj, newEntries);
        fs_1.default.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
        filesWritten++;
        totalKeys += Object.keys(newEntries).length;
        if (keysAdded.length > 0 || keysUpdated.length > 0) {
            results.push(`${localeName}.json: +${keysAdded.length} 新增, ~${keysUpdated.length} 更新`);
        }
        else {
            results.push(`${localeName}.json: 无变化 (${Object.keys(newEntries).length} 条已存在)`);
        }
    }
    // Detect local locale files that got no remote data
    const localLocaleNames = fs_1.default.readdirSync(locales_path)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    const missingLocales = (0, utils_js_1.findMissingLocales)(localLocaleNames, Object.keys(allStrings));
    let output = `写入完成!\n`;
    output += `- 目录: ${locales_path}\n`;
    output += `- 写入 ${filesWritten} 个文件, 跳过 ${filesSkipped} 个 (项目中不存在)\n`;
    output += `- 共 ${totalKeys} 条字符串\n\n`;
    output += results.map(r => `  ${r}`).join('\n');
    if (missingLocales.length > 0) {
        output += `\n\n⚠️ 以下 ${missingLocales.length} 个本地语言文件未获得远程翻译，未被更新:\n`;
        output += missingLocales.map(name => `  - ${name}.json`).join('\n');
        output += `\n请确认远程平台是否已为这些语言提供翻译。`;
    }
    return { content: [{ type: 'text', text: output }] };
});
// --- Start ---
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('Language MCP Server running on stdio');
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
