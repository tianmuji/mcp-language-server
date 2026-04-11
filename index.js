#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import nodePath from "node:path";
import { execSync, exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import { startSsoLogin, createCredentialsManager } from "mcp-sso-auth";

// 脚本所在目录
const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

// ==================== SSO 认证模块（使用 mcp-sso-auth） ====================

const SSO_LOGIN_URL = process.env.SSO_LOGIN_URL || "https://web-sso.intsig.net/login";
const SSO_PLATFORM_ID = process.env.SSO_PLATFORM_ID || "OdliDeAnVtlUA5cGwwxZPHUyXtqPCcNw";
const SSO_CALLBACK_DOMAIN = process.env.SSO_CALLBACK_DOMAIN || "https://www-sandbox.camscanner.com/activity/mcp-auth-callback";
const SSO_CALLBACK_PORT = parseInt(process.env.SSO_CALLBACK_PORT || "9877", 10);

const credentialsManager = createCredentialsManager("language-mcp");
const { load: loadCredentials, save: saveCredentials, clear: clearCredentials } = credentialsManager;

/** Fetch session cookies and CSRF token from operate platform using sso_token */
function fetchSessionInfo(baseUrl, ssoToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + "/site/get-config");
    const mod = url.protocol === "https:" ? https : http;
    const options = {
      timeout: 10000,
      headers: {
        Cookie: `sso_token=${ssoToken}`,
        "x-requested-with": "XMLHttpRequest",
      },
    };
    const req = mod.get(url.toString(), options, (res) => {
      // Capture all cookies from set-cookie headers
      const rawCookies = res.headers["set-cookie"] || [];
      const cookiePairs = [];
      let csrfCookie = "";
      for (const c of rawCookies) {
        const m = c.match(/^([^=]+)=([^;]*)/);
        if (m) {
          cookiePairs.push(`${m[1]}=${m[2]}`);
          if (m[1] === "_csrf") csrfCookie = m[2];
        }
      }
      // Also include sso_token in the cookie string
      cookiePairs.push(`sso_token=${ssoToken}`);
      const sessionCookie = cookiePairs.join("; ");

      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        // Extract client-side CSRF token from hidden form field
        let csrfToken = "";
        const fieldMatch = body.match(/name="_csrf"\s+value="([^"]+)"/);
        if (fieldMatch) {
          csrfToken = fieldMatch[1];
        } else {
          const altMatch = body.match(/value="([^"]+)"\s*>/);
          if (altMatch && csrfCookie) csrfToken = altMatch[1];
        }
        resolve({ sessionCookie, csrfToken });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Session fetch timeout")); });
  });
}

// In-memory credentials
let currentCredentials = loadCredentials();
if (currentCredentials) {
  console.error("Restored saved credentials (valid until " + new Date(currentCredentials.expiresAt).toLocaleString() + ")");
}

function isAuthenticated() {
  return !!(currentCredentials && Date.now() < currentCredentials.expiresAt);
}

function requireAuth() {
  if (!isAuthenticated()) {
    return "Not authenticated. Please call the 'authenticate' tool first to login via SSO.";
  }
  return null;
}

// ==================== 原有配置 ====================

// 从文件读取（保留作为 fallback）
function loadFile(filename) {
  try {
    return fs.readFileSync(nodePath.join(__dirname, filename), "utf-8").trim();
  } catch {
    return "";
  }
}

// 基础配置
const BASE_URL = process.env.OPERATE_BASE_URL || "https://operate.intsig.net";
const PORT = parseInt(process.env.PORT || "3100", 10);
const MODE = process.argv.includes("--http") ? "http" : "stdio";

// 产品ID映射
const PRODUCT_MAP = {
  1: "CamCard",
  2: "CamScanner",
  44: "CamScanner Lite",
  47: "CS PDF",
  53: "CS Harmony",
};

// 语言ID → locale 文件名映射（兼容 cs-i18n 工具）
// 映射关系通过 export-string 导出翻译值反推校验确认
const LANGUAGE_LOCALE_MAP = {
  "1": "ZhCn",    // 简体中文
  "2": "EnUs",    // 英语
  "3": "DeDe",    // 德语
  "4": "FrFr",    // 法语
  "5": "JaJp",    // 日语
  "6": "KoKr",    // 韩语
  "7": "ZhTw",    // 繁体中文
  "8": "PtBr",    // 巴西葡萄牙语
  "9": "RuRu",    // 俄语
  "10": "SkSk",   // 斯洛伐克语
  "11": "CsCs",   // 捷克语
  "12": "EsEs",   // 西班牙语
  "13": "PlPl",   // 波兰语
  "14": "ItIt",   // 意大利语
  "15": "TrTr",   // 土耳其语
  "16": "ArSa",   // 阿拉伯语
  "17": "PtPt",   // 葡萄牙语
  "20": "FiFi",   // 芬兰语
  "22": "MsMy",   // 马来语
  "23": "Th",     // 泰语
  "24": "FilPh",  // 菲律宾语
  "25": "InId",   // 印度尼西亚语
  "26": "ViVn",   // 越南语
  "27": "BnBd",   // 孟加拉语
  "28": "FaIr",   // 波斯语
  "29": "HiDi",   // 印地语
  "30": "NlNl",   // 荷兰语
  "31": "ElEl",   // 希腊语
  "32": "HuHu",   // 匈牙利语
  "33": "UkUa",   // 乌克兰语
  "34": "NoNo",   // 挪威语
  "35": "DaDk",   // 丹麦语
  "36": "UrPk",   // 乌尔都语
  "37": "HrHr",   // 克罗地亚语
  "38": "HyAm",   // 亚美尼亚语
  "39": "BgBg",   // 保加利亚语
  "40": "SiLk",   // 僧伽罗语
  "41": "IsIs",   // 冰岛语
  "42": "KkKz",   // 哈萨克语
  "43": "SrRs",   // 塞尔维亚语
  "44": "NeNp",   // 尼泊尔语
  "45": "LvLv",   // 拉脱维亚语
  "46": "SlSi",   // 斯洛文尼亚语
  "47": "SwKe",   // 斯瓦希里语
  "48": "KaGe",   // 格鲁吉亚语
  "49": "EtEe",   // 爱沙尼亚语
  "50": "SvSe",   // 瑞典语
  "53": "LtLt",   // 立陶宛语
  "54": "MyMm",   // 缅甸语
  "55": "RoRo",   // 罗马尼亚语
  "56": "LoLa",   // 老挝语
  "57": "MnMn",   // 蒙古语
  "58": "AzAz",   // 阿塞拜疆语
  "60": "SqAl",   // 阿尔巴尼亚语
  "61": "MkMk",   // 马其顿语
  "68": "IwIl",   // 希伯来语
  "70": "KyKg",   // 吉尔吉斯语
  "76": "KmKh",   // 高棉语
  "77": "BsBa",   // 波斯尼亚语
  "78": "LbLu",   // 卢森堡语
  "79": "RwRw",   // 卢旺达语
  "80": "MtMt",   // 马耳他语
  "81": "UzUz",   // 乌兹别克语
};

// %s → {0}, {1}, {2}... 替换
function fixPlaceholders(value) {
  let cnt = 0;
  return value
    .replace(/%s/g, () => `{${cnt++}}`)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n');
}

// 从 API 返回的版本数据中提取 key-value pairs
function extractStrings(versions, platformId) {
  // 收集所有字符串，按 language_id 分组：{ langId: { key: value } }
  const result = {};
  for (const version of versions) {
    const strings = version.ar_string || version.strings || [];
    // 获取该版本支持的语言列表
    const languages = version.ar_language || [];
    for (const str of strings) {
      const key = str.keys?.[platformId] || str.keys?.["0"] || Object.values(str.keys || {})[0];
      if (!key) continue;
      for (const langId of languages) {
        const value = str.values?.[langId];
        if (!value) continue;
        if (!result[langId]) result[langId] = {};
        result[langId][key] = fixPlaceholders(value);
      }
    }
  }
  return result;
}

// 通用请求方法 — 优先使用 SSO 凭据，fallback 到文件/环境变量
async function operatePost(urlPath, params) {
  let cookie, csrfToken;

  // Extra cookies from file/env (e.g. nginx st cookie)
  const extraCookie = loadFile(".cookie") || process.env.OPERATE_COOKIE || "";

  if (isAuthenticated()) {
    const ssoCookie = currentCredentials.sessionCookie || `sso_token=${currentCredentials.ssoToken}`;
    // SSO cookie 优先，extraCookie 作为补充放在后面
    cookie = extraCookie ? `${ssoCookie}; ${extraCookie}` : ssoCookie;
    csrfToken = currentCredentials.csrfToken || loadFile(".csrf-token") || process.env.OPERATE_CSRF_TOKEN || "";
  } else {
    cookie = extraCookie;
    csrfToken = loadFile(".csrf-token") || process.env.OPERATE_CSRF_TOKEN || "";
  }

  const body = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${urlPath}`;

  console.error(`[DEBUG] curl ${url}, auth: ${isAuthenticated() ? "SSO" : "file/env"}`);

  const curlScript = `#!/bin/bash
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY
curl -s '${url}' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'content-type: application/x-www-form-urlencoded' \\
  -H 'x-requested-with: XMLHttpRequest' \\
  -H 'x-csrf-token: ${csrfToken}' \\
  -H 'origin: ${BASE_URL}' \\
  -H 'referer: ${BASE_URL}/multilanguage/edit-language' \\
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36' \\
  -b '${cookie.replace(/'/g, "\\'")}' \\
  --data-raw '${body.replace(/'/g, "\\'")}'
`;
  const scriptFile = nodePath.join(__dirname, ".curl-request.sh");
  fs.writeFileSync(scriptFile, curlScript, { mode: 0o755 });

  try {
    const text = execSync(`bash '${scriptFile}'`, {
      encoding: "utf-8",
      timeout: 30000,
    });
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`响应非 JSON: ${text.substring(0, 300)}`);
    }
  } catch (err) {
    if (err.message?.startsWith("响应非 JSON")) throw err;
    throw new Error(`curl 请求失败: ${err.stderr?.substring(0, 500) || err.message?.substring(0, 300)}`);
  }
}

// 注册所有 tools
function registerTools(server) {
  // Tool 0: SSO 认证
  server.tool(
    "authenticate",
    "Login to operate platform via SSO QR code scan. Opens browser for authentication.",
    {},
    async () => {
      if (isAuthenticated()) {
        return { content: [{ type: "text", text: "Already authenticated. Use 'logout' tool to re-authenticate." }] };
      }
      try {
        const creds = await startSsoLogin({
          ssoLoginUrl: SSO_LOGIN_URL,
          platformId: SSO_PLATFORM_ID,
          callbackDomain: SSO_CALLBACK_DOMAIN,
          callbackPort: SSO_CALLBACK_PORT,
          serverName: "多语言 MCP Server",
          async exchangeToken(ssoToken) {
            const { sessionCookie, csrfToken } = await fetchSessionInfo(BASE_URL, ssoToken);
            const result = { ssoToken, sessionCookie, csrfToken, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
            saveCredentials(result);
            return result;
          },
        });
        currentCredentials = creds;
        return { content: [{ type: "text", text: "Authentication successful! You can now use all language tools." }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Authentication failed: ${err.message}` }] };
      }
    }
  );

  // Tool: logout
  server.tool(
    "logout",
    "Clear saved credentials and logout.",
    {},
    async () => {
      clearCredentials();
      currentCredentials = null;
      return { content: [{ type: "text", text: "Logged out. Call 'authenticate' to login again." }] };
    }
  );

  // Tool 1: 获取版本列表
  server.tool(
    "get-version-list",
    "获取指定产品的多语言版本列表。返回每个版本的 version_id、版本号、支持的平台和语言。",
    {
      product_id: z
        .string()
        .describe(
          `产品ID。常用值: ${Object.entries(PRODUCT_MAP)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}`
        ),
    },
    async ({ product_id }) => {
      const authError = requireAuth();
      if (authError) return { content: [{ type: "text", text: authError }] };
      const data = await operatePost(
        "/language/language/get-version-list",
        { product_id }
      );
      if (data.errno !== 0) {
        return {
          content: [
            {
              type: "text",
              text: `错误: ${data.message || JSON.stringify(data)}`,
            },
          ],
        };
      }
      const list = data.data.list || [];
      const summary = list
        .map(
          (v) =>
            `- version_id=${v.version_id}, version=${v.version_number}, platforms=${v.platforms}, languages=${v.supported_languages}`
        )
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `共 ${data.data.total} 个版本:\n${summary}`,
          },
        ],
      };
    }
  );

  // Tool 2: 搜索多语言字符串
  server.tool(
    "search-string",
    "按关键词搜索多语言字符串。可指定版本精准搜索，返回 string_id、key、中英文翻译等信息。",
    {
      product_id: z.string().describe("产品ID，如 2 表示 CamScanner"),
      word: z.string().describe("搜索关键词（中文或英文）"),
      version_id: z
        .string()
        .optional()
        .describe("版本ID，不传则搜索所有版本"),
      fuzzy: z
        .string()
        .optional()
        .default("1")
        .describe("1=模糊匹配，0=精确匹配"),
      page: z.string().optional().default("1").describe("页码"),
      page_size: z
        .string()
        .optional()
        .default("20")
        .describe("每页条数，最大100"),
    },
    async ({ product_id, word, version_id, fuzzy, page, page_size }) => {
      const authError = requireAuth();
      if (authError) return { content: [{ type: "text", text: authError }] };
      const params = { product_id, word, fuzzy, page, page_size };
      if (version_id) params.version_id = version_id;

      const data = await operatePost(
        "/language/language/get-string-search",
        params
      );
      if (data.errno !== 0) {
        return {
          content: [
            {
              type: "text",
              text: `错误: ${data.message || JSON.stringify(data)}`,
            },
          ],
        };
      }

      // data.data 可能是数组（直接版本列表）或对象（含 list 字段）
      const versions = Array.isArray(data.data) ? data.data : (data.data?.list || []);
      if (versions.length === 0) {
        return {
          content: [
            { type: "text", text: `未找到匹配 "${word}" 的字符串` },
          ],
        };
      }

      let output = `共 ${versions.length} 个版本有匹配结果:\n\n`;
      for (const version of versions) {
        output += `## 版本 ${version.version_number} (version_id=${version.version_id})\n`;
        const strings = version.ar_string || version.strings || [];
        for (const str of strings) {
          const keys = str.keys
            ? Object.entries(str.keys)
                .map(([p, k]) => `platform_${p}: ${k}`)
                .join(", ")
            : "无";
          const zhCN = str.values?.["1"] || str.values?.["0"] || "";
          const enUS = str.values?.["2"] || str.values?.["0"] || "";
          const zhTW = str.values?.["7"] || "";
          output += `- string_id: ${str.id}\n`;
          output += `  key: ${keys}\n`;
          output += `  中文: ${zhCN}\n`;
          output += `  英文: ${enUS}\n`;
          if (zhTW) output += `  繁体: ${zhTW}\n`;
          output += "\n";
        }
      }
      return { content: [{ type: "text", text: output }] };
    }
  );

  // Tool 3: 导出字符串为 locale JSON 格式（兼容 cs-i18n）
  server.tool(
    "export-string",
    '搜索多语言字符串并导出为兼容 cs-i18n 的 locale JSON 格式。支持单语言或全部语言导出，自动将 %s 替换为 {0}/{1}/{2}。',
    {
      product_id: z.string().describe("产品ID，如 2 表示 CamScanner"),
      word: z.string().describe("搜索关键词（中文或英文）"),
      version_id: z
        .string()
        .optional()
        .describe("版本ID，不传则搜索所有版本"),
      platform_id: z
        .string()
        .optional()
        .default("4")
        .describe("平台ID，用于选择 key: 1=Android, 3=iOS, 4=Web"),
      language_id: z
        .string()
        .optional()
        .describe(
          "目标语言ID，不传则导出所有语言。常用: 1=中文, 2=英文, 7=繁体中文"
        ),
    },
    async ({ product_id, word, version_id, platform_id, language_id }) => {
      const authError = requireAuth();
      if (authError) return { content: [{ type: "text", text: authError }] };
      const params = { product_id, word, fuzzy: "1", page: "1", page_size: "100" };
      if (version_id) params.version_id = version_id;

      const data = await operatePost(
        "/language/language/get-string-search",
        params
      );
      if (data.errno !== 0) {
        return {
          content: [{ type: "text", text: `错误: ${data.message || JSON.stringify(data)}` }],
        };
      }

      const versions = Array.isArray(data.data) ? data.data : (data.data?.list || []);
      if (versions.length === 0) {
        return {
          content: [{ type: "text", text: `未找到匹配 "${word}" 的字符串` }],
        };
      }

      const allStrings = extractStrings(versions, platform_id);

      if (language_id) {
        // 单语言导出
        const localeObj = allStrings[language_id] || {};
        if (Object.keys(localeObj).length === 0) {
          return {
            content: [{ type: "text", text: `找到字符串但语言ID=${language_id} 无翻译内容` }],
          };
        }
        const localeName = LANGUAGE_LOCALE_MAP[language_id] || `lang_${language_id}`;
        const json = JSON.stringify(localeObj, null, 2);
        return {
          content: [{
            type: "text",
            text: `导出 ${Object.keys(localeObj).length} 条字符串 → ${localeName}.json:\n\n\`\`\`json\n${json}\n\`\`\``,
          }],
        };
      }

      // 全部语言导出
      let output = `共匹配 ${Object.keys(allStrings).length} 种语言:\n\n`;
      for (const [langId, localeObj] of Object.entries(allStrings)) {
        const localeName = LANGUAGE_LOCALE_MAP[langId] || `lang_${langId}`;
        const json = JSON.stringify(localeObj, null, 2);
        output += `### ${localeName}.json (语言ID=${langId}, ${Object.keys(localeObj).length} 条)\n\`\`\`json\n${json}\n\`\`\`\n\n`;
      }
      return { content: [{ type: "text", text: output }] };
    }
  );

  // Tool 4: 写入 locales 目录（兼容 cs-i18n 项目结构）
  server.tool(
    "write-locales",
    '搜索多语言字符串并直接写入项目的 locales 目录，兼容 cs-i18n 工具格式。自动合并到已有的 locale JSON 文件，%s 自动替换为 {0}/{1}/{2}。',
    {
      product_id: z.string().describe("产品ID，如 2 表示 CamScanner"),
      word: z.string().describe("搜索关键词（中文或英文）"),
      locales_path: z
        .string()
        .describe("locales 目录的绝对路径，如 /Users/xxx/project/src/locales"),
      version_id: z
        .string()
        .optional()
        .describe("版本ID，不传则搜索所有版本"),
      platform_id: z
        .string()
        .optional()
        .default("4")
        .describe("平台ID，用于选择 key: 1=Android, 3=iOS, 4=Web"),
    },
    async ({ product_id, word, locales_path, version_id, platform_id }) => {
      const authError = requireAuth();
      if (authError) return { content: [{ type: "text", text: authError }] };
      // 验证 locales 目录存在
      if (!fs.existsSync(locales_path)) {
        return {
          content: [{ type: "text", text: `错误: locales 目录不存在: ${locales_path}` }],
        };
      }

      const params = { product_id, word, fuzzy: "1", page: "1", page_size: "100" };
      if (version_id) params.version_id = version_id;

      const data = await operatePost(
        "/language/language/get-string-search",
        params
      );
      if (data.errno !== 0) {
        return {
          content: [{ type: "text", text: `错误: ${data.message || JSON.stringify(data)}` }],
        };
      }

      const versions = Array.isArray(data.data) ? data.data : (data.data?.list || []);
      if (versions.length === 0) {
        return {
          content: [{ type: "text", text: `未找到匹配 "${word}" 的字符串` }],
        };
      }

      const allStrings = extractStrings(versions, platform_id);

      // 备份并写入每个语言文件
      const results = [];
      let totalKeys = 0;
      let filesWritten = 0;
      let filesSkipped = 0;

      for (const [langId, newEntries] of Object.entries(allStrings)) {
        const localeName = LANGUAGE_LOCALE_MAP[langId];
        if (!localeName) {
          filesSkipped++;
          continue;
        }

        const filePath = nodePath.join(locales_path, `${localeName}.json`);
        if (!fs.existsSync(filePath)) {
          filesSkipped++;
          continue;
        }

        // 读取已有文件
        let existingObj = {};
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          existingObj = JSON.parse(content);
        } catch {
          // 文件为空或格式错误，使用空对象
        }

        // 修复已有值中的 %s
        for (const key of Object.keys(existingObj)) {
          if (typeof existingObj[key] === "string" && existingObj[key].includes("%s")) {
            existingObj[key] = fixPlaceholders(existingObj[key]);
          }
        }

        // 保留 insert_before_this_line 的位置约定
        const insertMarker = existingObj["insert_before_this_line"];
        delete existingObj["insert_before_this_line"];

        // 合并新字符串（覆盖已有）
        const keysAdded = [];
        const keysUpdated = [];
        for (const [key, value] of Object.entries(newEntries)) {
          if (existingObj[key] === undefined) {
            keysAdded.push(key);
          } else if (existingObj[key] !== value) {
            keysUpdated.push(key);
          }
          existingObj[key] = value;
        }

        // 恢复 insert_before_this_line
        if (insertMarker) {
          existingObj["insert_before_this_line"] = insertMarker;
        }

        // 写入文件
        fs.writeFileSync(filePath, JSON.stringify(existingObj, null, 2) + "\n");
        filesWritten++;
        totalKeys += Object.keys(newEntries).length;
        if (keysAdded.length > 0 || keysUpdated.length > 0) {
          results.push(`${localeName}.json: +${keysAdded.length} 新增, ~${keysUpdated.length} 更新`);
        } else {
          results.push(`${localeName}.json: 无变化 (${Object.keys(newEntries).length} 条已存在)`);
        }
      }

      let output = `写入完成！\n`;
      output += `- 目录: ${locales_path}\n`;
      output += `- 写入 ${filesWritten} 个文件, 跳过 ${filesSkipped} 个 (项目中不存在)\n`;
      output += `- 共 ${totalKeys} 条字符串\n\n`;
      output += results.map(r => `  ${r}`).join("\n");

      return { content: [{ type: "text", text: output }] };
    }
  );
}

// HTTP 模式启动
async function startHttp() {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // 健康检查
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      const server = new McpServer({
        name: "language-server",
        version: "1.0.0",
      });
      registerTools(server);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Language MCP Server (HTTP) running at http://0.0.0.0:${PORT}/mcp`);
  });
}

// Stdio 模式启动
async function startStdio() {
  const server = new McpServer({
    name: "language-server",
    version: "1.0.0",
  });
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Language MCP Server (stdio) running");
}

// 入口
const main = MODE === "http" ? startHttp : startStdio;
main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
