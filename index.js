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

// 脚本所在目录
const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

// ==================== SSO 认证模块 ====================

const CREDENTIALS_DIR = nodePath.join(
  process.env.HOME || process.env.USERPROFILE || "/tmp",
  ".language-mcp"
);
const CREDENTIALS_FILE = nodePath.join(CREDENTIALS_DIR, "credentials.json");

// SSO 配置（从环境变量读取）
const SSO_LOGIN_URL = process.env.SSO_LOGIN_URL || "https://web-sso-sandbox.intsig.net/login";
const SSO_PLATFORM_ID = process.env.SSO_PLATFORM_ID || "QlCcDew3su0CA5eHRe20x61oTfeYvlmV";
const SSO_CALLBACK_DOMAIN = process.env.SSO_CALLBACK_DOMAIN || "http://yapi-mcp-auth.camscanner.com:9877";
const SSO_CALLBACK_PORT = parseInt(process.env.SSO_CALLBACK_PORT || "9877", 10);

/** Load saved credentials from disk */
function loadCredentials() {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8"));
    if (data.expiresAt && Date.now() < data.expiresAt) return data;
    return null;
  } catch {
    return null;
  }
}

/** Save credentials to disk */
function saveCredentials(creds) {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
}

/** Clear saved credentials */
function clearCredentials() {
  try { if (fs.existsSync(CREDENTIALS_FILE)) fs.unlinkSync(CREDENTIALS_FILE); } catch {}
}

/** Fetch CSRF token from operate platform using sso_token */
function fetchCsrfToken(baseUrl, ssoToken) {
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
      // Extract _csrf from Set-Cookie
      const cookies = res.headers["set-cookie"] || [];
      let csrf = "";
      for (const c of cookies) {
        const m = c.match(/^_csrf=([^;]*)/);
        if (m) { csrf = m[1]; break; }
      }
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        // Also try to extract csrf from response body (Yii2 meta tag)
        if (!csrf) {
          const bodyMatch = body.match(/csrf[_-]token['":\s]+['"]([^'"]+)/i);
          if (bodyMatch) csrf = bodyMatch[1];
        }
        resolve(csrf);
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("CSRF fetch timeout")); });
  });
}

/** Get the frontmost app name (macOS only) */
function getFrontmostApp() {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    exec(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      (err, stdout) => resolve(err ? null : stdout.trim())
    );
  });
}

/** Activate an app by name (macOS only) */
function activateApp(appName) {
  if (!appName || process.platform !== "darwin") return;
  exec(`osascript -e 'tell application "${appName}" to activate'`, (err) => {
    if (err) console.error(`Failed to activate app "${appName}": ${err.message}`);
  });
}

/** Open browser */
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) console.error(`Failed to open browser: ${err.message}`); });
}

/** SSO login flow */
function startSsoLogin(baseUrl) {
  return new Promise(async (resolve, reject) => {
    // Remember which app was active before opening browser
    const previousApp = await getFrontmostApp();
    console.error(`[AUTH] Previous frontmost app: ${previousApp || "unknown"}`);

    // SSO redirects to the relay page, which then forwards token to localhost
    const isLocal = SSO_CALLBACK_DOMAIN.includes('localhost') || SSO_CALLBACK_DOMAIN.includes('127.0.0.1');
    const relayUrl = isLocal
      ? SSO_CALLBACK_DOMAIN
      : `${SSO_CALLBACK_DOMAIN}${SSO_CALLBACK_DOMAIN.includes('?') ? '&' : '?'}port=${SSO_CALLBACK_PORT}`;
    const ssoUrl = `${SSO_LOGIN_URL}?platform_id=${SSO_PLATFORM_ID}&redirect=${encodeURIComponent(relayUrl)}`;

    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || "/", `http://localhost:${SSO_CALLBACK_PORT}`);

      if (reqUrl.pathname === "/") {
        const ssoToken = reqUrl.searchParams.get("token");
        if (!ssoToken) {
          // First redirect from SSO without token — redirect back to SSO for password input
          console.error("[AUTH] Callback received without token, redirecting back to SSO for password...");
          res.writeHead(302, { Location: ssoUrl });
          res.end();
          return;
        }

        try {
          // Fetch CSRF token using the SSO token
          const csrfToken = await fetchCsrfToken(baseUrl, ssoToken);

          const creds = {
            ssoToken,
            csrfToken,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 1 day (SSO token expiry)
          };
          saveCredentials(creds);

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
              <div style="text-align:center;">
                <h1 style="color:#52c41a;">&#10003; 登录成功</h1>
                <p>多语言 MCP Server 已获取认证信息，正在返回应用…</p>
              </div>
            </body></html>
            <script>setTimeout(function(){ window.close(); }, 1000);</script>
          `);
          server.close();
          // Switch back to the original app
          activateApp(previousApp);
          resolve(creds);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h2>登录失败：${err.message}</h2>`);
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(SSO_CALLBACK_PORT, () => {
      console.error(`Auth callback server listening on port ${SSO_CALLBACK_PORT}`);
      openBrowser(ssoUrl);
    });
    server.on("error", (err) => reject(new Error(`Failed to start auth server: ${err.message}`)));
    setTimeout(() => { server.close(); reject(new Error("SSO login timed out (5 minutes)")); }, 5 * 60 * 1000);
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
const BASE_URL = process.env.OPERATE_BASE_URL || "https://operate-test.intsig.net";
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
const LANGUAGE_LOCALE_MAP = {
  "1": "ZhCn",    // 简体中文
  "2": "EnUs",    // 英语
  "3": "JaJp",    // 日语
  "4": "KoKr",    // 韩语
  "5": "FrFr",    // 法语
  "6": "DeDe",    // 德语
  "7": "ZhTw",    // 繁体中文
  "8": "PtBr",    // 巴西葡萄牙语
  "9": "EsEs",    // 西班牙语
  "10": "ItIt",   // 意大利语
  "11": "RuRu",   // 俄语
  "12": "TrTr",   // 土耳其语
  "13": "ArSa",   // 阿拉伯语
  "14": "ThTh",   // 泰语(Th)
  "15": "PlPl",   // 波兰语
  "16": "ViVn",   // 越南语
  "17": "InId",   // 印度尼西亚语
  "19": "MsMy",   // 马来语
  "20": "NlNl",   // 荷兰语
  "22": "HiDi",   // 印地语
  "23": "BnBd",   // 孟加拉语
  "24": "CsCs",   // 捷克语
  "25": "SkSk",   // 斯洛伐克语
  "26": "FilPh",  // 菲律宾语
  "27": "ElEl",   // 希腊语
  "28": "PtPt",   // 葡萄牙语
  "29": "RoRo",   // 罗马尼亚语
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

  if (isAuthenticated()) {
    cookie = `sso_token=${currentCredentials.ssoToken}`;
    csrfToken = currentCredentials.csrfToken || "";
  } else {
    cookie = loadFile(".cookie") || process.env.OPERATE_COOKIE || "";
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
        const creds = await startSsoLogin(BASE_URL);
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
