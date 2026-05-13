import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import { createCredentialsManager, startSsoLogin as ssoLogin } from '@camscanner/mcp-sso-auth'
import type { OperateCredentials } from './operate-client.js'

// Environment configuration
const SSO_LOGIN_URL = process.env.SSO_LOGIN_URL || 'https://web-sso.intsig.net/login'
const SSO_PLATFORM_ID = process.env.SSO_PLATFORM_ID || 'OdliDeAnVtlUA5cGwwxZPHUyXtqPCcNw'
const SSO_CALLBACK_DOMAIN = process.env.SSO_CALLBACK_DOMAIN || 'https://www-sandbox.camscanner.com/activity/mcp-auth-callback'
const SSO_CALLBACK_PORT = parseInt(process.env.SSO_CALLBACK_PORT || '9881', 10)
const OPERATE_BASE_URL = process.env.OPERATE_BASE_URL || 'https://operate.intsig.net'

const credentialsManager = createCredentialsManager('language-mcp')

/** Fetch session cookies and CSRF token from operate platform using sso_token */
function fetchSessionInfo(baseUrl: string, ssoToken: string): Promise<{ sessionCookie: string; csrfToken: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + '/site/get-config')
    const mod = url.protocol === 'https:' ? https : http

    const options = {
      timeout: 10000,
      headers: {
        Cookie: `sso_token=${ssoToken}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    }

    const req = mod.get(url.toString(), options, (res) => {
      const rawCookies = res.headers['set-cookie'] || []
      const cookiePairs: string[] = []
      for (const c of rawCookies) {
        const m = c.match(/^([^=]+)=([^;]*)/)
        if (m) {
          cookiePairs.push(`${m[1]}=${m[2]}`)
        }
      }
      cookiePairs.push(`sso_token=${ssoToken}`)
      const sessionCookie = cookiePairs.join('; ')

      let body = ''
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () => {
        let csrfToken = ''
        const fieldMatch = body.match(/name="_csrf"\s+value="([^"]+)"/)
        if (fieldMatch) {
          csrfToken = fieldMatch[1]
        }
        resolve({ sessionCookie, csrfToken })
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Session fetch timeout')) })
  })
}

export async function loadCredentials(): Promise<OperateCredentials | null> {
  const data = credentialsManager.load()
  if (data && data.ssoToken) return data as OperateCredentials
  return null
}

export async function saveCredentials(creds: OperateCredentials): Promise<void> {
  credentialsManager.save(creds)
}

export async function clearCredentials(): Promise<void> {
  credentialsManager.clear()
}

export interface SsoConfig {
  operateBaseUrl: string
}

export async function startSsoLogin(config: SsoConfig): Promise<OperateCredentials> {
  const baseUrl = config.operateBaseUrl || OPERATE_BASE_URL

  const creds = await ssoLogin({
    ssoLoginUrl: SSO_LOGIN_URL,
    platformId: SSO_PLATFORM_ID,
    callbackDomain: SSO_CALLBACK_DOMAIN,
    callbackPort: SSO_CALLBACK_PORT,
    serverName: 'Language MCP Server',
    async exchangeToken(ssoToken: string) {
      const { sessionCookie, csrfToken } = await fetchSessionInfo(baseUrl, ssoToken)
      const result: OperateCredentials = {
        ssoToken,
        sessionCookie,
        csrfToken,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }
      credentialsManager.save(result)
      return result
    },
  })

  return creds as OperateCredentials
}
