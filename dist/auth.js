"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCredentials = loadCredentials;
exports.saveCredentials = saveCredentials;
exports.clearCredentials = clearCredentials;
exports.startSsoLogin = startSsoLogin;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const playwright_core_1 = require("playwright-core");
// --- Credentials persistence ---
const CREDS_DIR = path_1.default.join(os_1.default.homedir(), '.language-mcp');
const CREDS_FILE = path_1.default.join(CREDS_DIR, 'credentials.json');
async function loadCredentials() {
    try {
        if (!fs_1.default.existsSync(CREDS_FILE))
            return null;
        const data = JSON.parse(fs_1.default.readFileSync(CREDS_FILE, 'utf-8'));
        if (data && data.expiresAt > Date.now())
            return data;
        return null;
    }
    catch {
        return null;
    }
}
async function saveCredentials(creds) {
    if (!fs_1.default.existsSync(CREDS_DIR))
        fs_1.default.mkdirSync(CREDS_DIR, { recursive: true });
    fs_1.default.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
}
async function clearCredentials() {
    try {
        fs_1.default.unlinkSync(CREDS_FILE);
    }
    catch { /* ignore */ }
}
// --- Find system Chromium installed by Playwright ---
function findChromium() {
    const cacheDir = path_1.default.join(os_1.default.homedir(), 'Library', 'Caches', 'ms-playwright');
    if (!fs_1.default.existsSync(cacheDir))
        return undefined;
    const dirs = fs_1.default.readdirSync(cacheDir)
        .filter(d => d.startsWith('chromium-'))
        .sort()
        .reverse();
    for (const dir of dirs) {
        const candidates = [
            path_1.default.join(cacheDir, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            path_1.default.join(cacheDir, dir, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            path_1.default.join(cacheDir, dir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
            path_1.default.join(cacheDir, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
            path_1.default.join(cacheDir, dir, 'chrome-linux', 'chrome'),
        ];
        for (const c of candidates) {
            if (fs_1.default.existsSync(c))
                return c;
        }
    }
    return undefined;
}
/**
 * Launch a browser for the user to complete the full login flow
 * (SSO + zero-trust gateway), then extract all cookies and CSRF token.
 */
async function startSsoLogin(config) {
    const execPath = findChromium();
    if (!execPath) {
        throw new Error('Cannot find Chromium. Please install Playwright browsers: npx playwright install chromium');
    }
    // Persistent browser data dir — saves passwords, cookies across sessions
    const userDataDir = path_1.default.join(CREDS_DIR, 'browser-data');
    if (!fs_1.default.existsSync(userDataDir))
        fs_1.default.mkdirSync(userDataDir, { recursive: true });
    // Navigate to a page that requires auth — this triggers the SSO redirect chain
    const targetUrl = config.operateBaseUrl + '/multilanguage/edit-language';
    console.error('[Auth] Launching browser for login...');
    const context = await playwright_core_1.chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: execPath,
        ignoreHTTPSErrors: true,
    });
    try {
        const page = context.pages()[0] || await context.newPage();
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        // If already logged in (browser has valid cookies from previous session), skip waiting
        const currentHost = new URL(page.url()).hostname;
        if (currentHost !== 'operate.intsig.net') {
            console.error('[Auth] Waiting for user to complete login (up to 180s)...');
            await page.waitForURL(url => {
                const u = typeof url === 'string' ? new URL(url) : url;
                return u.hostname === 'operate.intsig.net';
            }, { timeout: 180000 });
        }
        // Ensure the page is fully loaded
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
        // Extract all cookies
        const cookies = await context.cookies();
        const operateCookies = cookies.filter(c => c.domain.includes('intsig.net') || c.domain.includes('operate'));
        if (operateCookies.length === 0) {
            throw new Error('No cookies captured after login. Please try again.');
        }
        // Navigate to /site/get-config to extract CSRF token
        await page.goto(config.operateBaseUrl + '/site/get-config', { waitUntil: 'domcontentloaded', timeout: 15000 });
        // Re-capture cookies (get-config may refresh JSESSID)
        const allCookies = (await context.cookies()).filter(c => c.domain.includes('intsig.net') || c.domain.includes('operate'));
        const finalCookie = allCookies.map(c => `${c.name}=${c.value}`).join('; ');
        let csrfToken = '';
        try {
            csrfToken = await page.evaluate(`
        (() => {
          const el = document.querySelector('input[name="_csrf"]');
          return el ? el.value : '';
        })()
      `);
        }
        catch { /* ignore */ }
        if (!csrfToken) {
            const html = await page.content();
            const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
            if (match)
                csrfToken = match[1];
        }
        if (!csrfToken) {
            throw new Error('Login succeeded but failed to extract CSRF token. Please try again.');
        }
        console.error('[Auth] Login successful! Cookies and CSRF token captured.');
        return {
            ssoToken: '',
            sessionCookie: finalCookie,
            csrfToken,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        };
    }
    finally {
        await context.close();
    }
}
