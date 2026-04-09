"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCredentials = loadCredentials;
exports.saveCredentials = saveCredentials;
exports.clearCredentials = clearCredentials;
exports.startSsoLogin = startSsoLogin;
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const url_1 = require("url");
// Dynamic import for ESM module (mcp-sso-auth)
let _ssoAuth = null;
async function getSsoAuth() {
    if (!_ssoAuth) {
        _ssoAuth = await Promise.resolve().then(() => __importStar(require('mcp-sso-auth')));
    }
    return _ssoAuth;
}
let _credsMgr = null;
async function getCredsMgr() {
    if (!_credsMgr) {
        const { createCredentialsManager } = await getSsoAuth();
        _credsMgr = createCredentialsManager('language-mcp');
    }
    return _credsMgr;
}
async function loadCredentials() {
    const mgr = await getCredsMgr();
    return mgr.load();
}
async function saveCredentials(creds) {
    const mgr = await getCredsMgr();
    mgr.save(creds);
}
async function clearCredentials() {
    const mgr = await getCredsMgr();
    mgr.clear();
}
async function startSsoLogin(config) {
    const { startSsoLogin: ssoLogin } = await getSsoAuth();
    return ssoLogin({
        ssoLoginUrl: config.ssoLoginUrl,
        platformId: config.platformId,
        callbackDomain: config.callbackDomain,
        callbackPort: config.callbackPort,
        serverName: '多语言 MCP Server',
        async exchangeToken(ssoToken) {
            return exchangeTokenWithOperate(config.operateBaseUrl, ssoToken);
        },
    });
}
/**
 * Exchange SSO token for operate platform session cookies and CSRF token.
 */
function exchangeTokenWithOperate(baseUrl, ssoToken) {
    return new Promise((resolve, reject) => {
        const url = new url_1.URL(baseUrl + '/site/get-config');
        const mod = url.protocol === 'https:' ? https_1.default : http_1.default;
        const options = {
            timeout: 10000,
            headers: {
                Cookie: `sso_token=${ssoToken}`,
                'x-requested-with': 'XMLHttpRequest',
            },
        };
        const req = mod.get(url.toString(), options, (res) => {
            const rawCookies = res.headers['set-cookie'] || [];
            const cookiePairs = [];
            for (const c of rawCookies) {
                const m = c.match(/^([^=]+)=([^;]*)/);
                if (m) {
                    cookiePairs.push(`${m[1]}=${m[2]}`);
                }
            }
            cookiePairs.push(`sso_token=${ssoToken}`);
            const sessionCookie = cookiePairs.join('; ');
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
                let csrfToken = '';
                const fieldMatch = body.match(/name="_csrf"\s+value="([^"]+)"/);
                if (fieldMatch) {
                    csrfToken = fieldMatch[1];
                }
                else {
                    // Fallback: try to extract from meta tag or alternative pattern
                    const altMatch = body.match(/value="([^"]+)"\s*>/);
                    if (altMatch)
                        csrfToken = altMatch[1];
                }
                if (!csrfToken) {
                    reject(new Error(`Failed to extract CSRF token from operate platform. Status: ${res.statusCode}. ` +
                        `Response length: ${body.length}. Try 'logout' then 'authenticate' again.`));
                    return;
                }
                resolve({
                    ssoToken,
                    sessionCookie,
                    csrfToken,
                    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
                });
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Session fetch timeout'));
        });
    });
}
