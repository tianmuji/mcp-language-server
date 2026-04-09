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
    // Navigate to a page that requires auth — this triggers the SSO redirect chain
    const targetUrl = config.operateBaseUrl + '/multilanguage/edit-language';
    const browser = await playwright_core_1.chromium.launch({
        headless: false,
        executablePath: execPath,
    });
    try {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await context.newPage();
        console.error('[Auth] Launching browser for login...');
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        // Wait for the user to complete login and land back on operate.intsig.net
        // The URL must be on operate.intsig.net AND not be a redirect to SSO
        console.error('[Auth] Waiting for user to complete login (up to 180s)...');
        await page.waitForURL(url => {
            const u = typeof url === 'string' ? new URL(url) : url;
            return u.hostname === 'operate.intsig.net';
        }, { timeout: 180000 });
        // Ensure the page is fully loaded
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
        // Extract all cookies
        const cookies = await context.cookies();
        const operateCookies = cookies.filter(c => c.domain.includes('intsig.net') || c.domain.includes('operate'));
        const sessionCookie = operateCookies
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
        if (!sessionCookie) {
            throw new Error('No cookies captured after login. Please try again.');
        }
        // Navigate to /site/get-config to extract CSRF token
        // (the SPA landing page doesn't contain it, but get-config always returns the HTML with _csrf)
        await page.goto(config.operateBaseUrl + '/site/get-config', { waitUntil: 'domcontentloaded', timeout: 15000 });
        // Re-capture cookies (get-config may refresh JSESSID)
        const refreshedCookies = await context.cookies();
        const allCookies = refreshedCookies.filter(c => c.domain.includes('intsig.net') || c.domain.includes('operate'));
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
        await browser.close();
    }
}
