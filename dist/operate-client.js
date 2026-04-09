"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperateClient = void 0;
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const url_1 = require("url");
class OperateClient {
    constructor(baseUrl) {
        this.credentials = null;
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }
    setCredentials(creds) {
        this.credentials = creds;
    }
    isAuthenticated() {
        return !!(this.credentials && Date.now() < this.credentials.expiresAt);
    }
    postOnce(path, params) {
        return new Promise((resolve, reject) => {
            if (!this.credentials) {
                reject(new Error("Not authenticated. Please call the 'authenticate' tool first."));
                return;
            }
            const url = new url_1.URL(this.baseUrl + path);
            const mod = url.protocol === 'https:' ? https_1.default : http_1.default;
            const body = new URLSearchParams(params).toString();
            const options = {
                method: 'POST',
                timeout: 30000,
                headers: {
                    'Cookie': this.credentials.sessionCookie,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': String(Buffer.byteLength(body)),
                    'x-csrf-token': this.credentials.csrfToken,
                    'x-requested-with': 'XMLHttpRequest',
                    'accept': 'application/json, text/plain, */*',
                    'origin': this.baseUrl,
                    'referer': `${this.baseUrl}/multilanguage/edit-language`,
                },
            };
            const req = mod.request(url.toString(), options, (res) => {
                if (res.statusCode === 302) {
                    res.resume();
                    reject(new Error("Authentication expired (302 redirect). Please call 'authenticate' to re-login."));
                    return;
                }
                let respBody = '';
                res.on('data', (chunk) => (respBody += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(respBody));
                    }
                    catch {
                        reject(new Error(`Invalid JSON response from ${path}: ${respBody.substring(0, 300)}`));
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout: ${path}`));
            });
            req.write(body);
            req.end();
        });
    }
    async post(path, params, retries = 2) {
        for (let i = 0; i <= retries; i++) {
            try {
                return await this.postOnce(path, params);
            }
            catch (err) {
                if (i === retries || !err.message?.includes('timeout'))
                    throw err;
                console.error(`[Operate] Retry ${i + 1}/${retries} for ${path}: ${err.message}`);
            }
        }
        throw new Error(`Request failed after ${retries} retries: ${path}`);
    }
}
exports.OperateClient = OperateClient;
