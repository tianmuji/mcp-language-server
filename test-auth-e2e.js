#!/usr/bin/env node

/**
 * E2E test for SSO authentication flow.
 *
 * Tests:
 * 1. Credential save / load / clear / expiry
 * 2. Successful SSO callback → credentials saved
 * 3. Missing token → 400 error
 * 4. Unknown path → 404
 * 5. CSRF token extraction from operate server
 *
 * Usage: node test-auth-e2e.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Test config ---
const TEST_PORT = 19877;
const TEST_CREDENTIALS_DIR = path.join(__dirname, ".test-credentials");
const TEST_CREDENTIALS_FILE = path.join(TEST_CREDENTIALS_DIR, "credentials.json");
const FAKE_OPERATE_PORT = 19878;

// --- Credential helpers (same logic as production code) ---

function saveCredentials(creds) {
  if (!fs.existsSync(TEST_CREDENTIALS_DIR)) {
    fs.mkdirSync(TEST_CREDENTIALS_DIR, { recursive: true });
  }
  fs.writeFileSync(TEST_CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
}

function loadCredentials() {
  try {
    if (!fs.existsSync(TEST_CREDENTIALS_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(TEST_CREDENTIALS_FILE, "utf-8"));
    if (data.expiresAt && Date.now() < data.expiresAt) return data;
    return null;
  } catch {
    return null;
  }
}

function clearCredentials() {
  try {
    if (fs.existsSync(TEST_CREDENTIALS_FILE)) fs.unlinkSync(TEST_CREDENTIALS_FILE);
  } catch {}
}

function cleanup() {
  try {
    if (fs.existsSync(TEST_CREDENTIALS_FILE)) fs.unlinkSync(TEST_CREDENTIALS_FILE);
    if (fs.existsSync(TEST_CREDENTIALS_DIR)) fs.rmdirSync(TEST_CREDENTIALS_DIR);
  } catch {}
}

/** HTTP GET → { statusCode, headers, body } */
function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Connection: "close" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () =>
        resolve({ statusCode: res.statusCode, headers: res.headers, body })
      );
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("httpGet timeout")); });
  });
}

// --- Fake operate server (returns _csrf cookie) ---

let fakeOperateServer;
function startFakeOperateServer() {
  return new Promise((resolve) => {
    fakeOperateServer = http.createServer((req, res) => {
      if (req.url.startsWith("/site/get-config")) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": "_csrf=test_csrf_token_abc123; Path=/",
        });
        res.end(JSON.stringify({ code: 0 }));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    fakeOperateServer.listen(FAKE_OPERATE_PORT, () => resolve());
  });
}

// --- Auth callback server (mimics production logic, no auto-close) ---

function createAuthServer(baseUrl) {
  let resolveAuth, rejectAuth;
  const authPromise = new Promise((res, rej) => {
    resolveAuth = res;
    rejectAuth = rej;
  });

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", `http://localhost:${TEST_PORT}`);

    if (reqUrl.pathname === "/callback") {
      const ssoToken = reqUrl.searchParams.get("token");
      if (!ssoToken) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>登录失败：未收到 token</h2>", () => {
          rejectAuth(new Error("No token received from SSO"));
        });
        return;
      }

      try {
        const csrfRes = await httpGet(`${baseUrl}/site/get-config`);
        const cookies = csrfRes.headers["set-cookie"] || [];
        let csrf = "";
        for (const c of cookies) {
          const m = c.match(/^_csrf=([^;]*)/);
          if (m) { csrf = m[1]; break; }
        }

        const creds = {
          ssoToken,
          csrfToken: csrf,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        };
        saveCredentials(creds);

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<html><body><h1>登录成功</h1><p>正在返回应用…</p></body></html>` +
          `<script>setTimeout(function(){ window.close(); }, 1000);</script>`
        );
        resolveAuth(creds);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h2>登录失败：${err.message}</h2>`);
        rejectAuth(err);
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return { server, authPromise };
}

function listenServer(server) {
  return new Promise((resolve) => server.listen(TEST_PORT, resolve));
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// --- Tests ---

describe("SSO Auth E2E", () => {
  before(async () => {
    cleanup();
    await startFakeOperateServer();
  });

  after(async () => {
    cleanup();
    if (fakeOperateServer) await new Promise((r) => fakeOperateServer.close(r));
  });

  describe("Credential management", () => {
    it("saveCredentials + loadCredentials round-trip", () => {
      const creds = { ssoToken: "tk_1", csrfToken: "cs_1", expiresAt: Date.now() + 60000 };
      saveCredentials(creds);
      assert.deepStrictEqual(loadCredentials(), creds);
    });

    it("expired credentials return null", () => {
      saveCredentials({ ssoToken: "tk_exp", csrfToken: "cs_exp", expiresAt: Date.now() - 1000 });
      assert.strictEqual(loadCredentials(), null);
    });

    it("clearCredentials removes file", () => {
      saveCredentials({ ssoToken: "tk_del", csrfToken: "cs_del", expiresAt: Date.now() + 60000 });
      assert.ok(fs.existsSync(TEST_CREDENTIALS_FILE));
      clearCredentials();
      assert.ok(!fs.existsSync(TEST_CREDENTIALS_FILE));
    });

    it("loadCredentials returns null when no file", () => {
      clearCredentials();
      assert.strictEqual(loadCredentials(), null);
    });
  });

  describe("Auth callback server", () => {
    it("successful login: returns 200, saves credentials, includes window.close()", async () => {
      const baseUrl = `http://localhost:${FAKE_OPERATE_PORT}`;
      const { server, authPromise } = createAuthServer(baseUrl);
      await listenServer(server);

      try {
        const res = await httpGet(`http://localhost:${TEST_PORT}/callback?token=sso_test_789`);

        assert.strictEqual(res.statusCode, 200);
        assert.ok(res.body.includes("登录成功"));
        assert.ok(res.body.includes("window.close()"));

        const creds = await authPromise;
        assert.strictEqual(creds.ssoToken, "sso_test_789");
        assert.strictEqual(creds.csrfToken, "test_csrf_token_abc123");
        assert.ok(creds.expiresAt > Date.now());

        // Verify persisted
        const saved = loadCredentials();
        assert.deepStrictEqual(saved, creds);
      } finally {
        await closeServer(server);
      }
    });

    it("missing token: rejects with 'No token received'", async () => {
      const baseUrl = `http://localhost:${FAKE_OPERATE_PORT}`;
      const { server, authPromise } = createAuthServer(baseUrl);
      await listenServer(server);

      // Run both in parallel — one may resolve/reject before the other
      const [httpSettled, authSettled] = await Promise.allSettled([
        httpGet(`http://localhost:${TEST_PORT}/callback`),
        authPromise,
      ]);

      // authPromise must reject with the right error
      assert.strictEqual(authSettled.status, "rejected");
      assert.match(authSettled.reason.message, /No token received/);

      // HTTP response: if fulfilled, should be 400
      if (httpSettled.status === "fulfilled") {
        assert.strictEqual(httpSettled.value.statusCode, 400);
        assert.ok(httpSettled.value.body.includes("登录失败"));
      }

      await closeServer(server);
    });

    it("unknown path: returns 404", async () => {
      const baseUrl = `http://localhost:${FAKE_OPERATE_PORT}`;
      const { server } = createAuthServer(baseUrl);
      await listenServer(server);

      try {
        const res = await httpGet(`http://localhost:${TEST_PORT}/unknown`);
        assert.strictEqual(res.statusCode, 404);
      } finally {
        await closeServer(server);
      }
    });
  });

  describe("CSRF token extraction", () => {
    it("fake operate server returns _csrf in Set-Cookie", async () => {
      const res = await httpGet(`http://localhost:${FAKE_OPERATE_PORT}/site/get-config`);
      assert.strictEqual(res.statusCode, 200);
      const cookies = res.headers["set-cookie"] || [];
      const csrfCookie = cookies.find((c) => c.startsWith("_csrf="));
      assert.ok(csrfCookie);
      assert.ok(csrfCookie.includes("test_csrf_token_abc123"));
    });
  });
});
