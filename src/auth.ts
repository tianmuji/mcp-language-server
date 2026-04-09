import http from 'http'
import https from 'https'
import { URL } from 'url'
import type { OperateCredentials } from './operate-client.js'

// Dynamic import for ESM module (mcp-sso-auth)
let _ssoAuth: any = null
async function getSsoAuth() {
  if (!_ssoAuth) {
    _ssoAuth = await import('mcp-sso-auth')
  }
  return _ssoAuth
}

let _credsMgr: any = null
async function getCredsMgr() {
  if (!_credsMgr) {
    const { createCredentialsManager } = await getSsoAuth()
    _credsMgr = createCredentialsManager('language-mcp')
  }
  return _credsMgr
}

export async function loadCredentials(): Promise<OperateCredentials | null> {
  const mgr = await getCredsMgr()
  return mgr.load()
}

export async function saveCredentials(creds: OperateCredentials): Promise<void> {
  const mgr = await getCredsMgr()
  mgr.save(creds)
}

export async function clearCredentials(): Promise<void> {
  const mgr = await getCredsMgr()
  mgr.clear()
}

export interface SsoConfig {
  ssoLoginUrl: string
  platformId: string
  callbackDomain: string
  callbackPort: number
  operateBaseUrl: string
}

export async function startSsoLogin(config: SsoConfig): Promise<OperateCredentials> {
  const { startSsoLogin: ssoLogin } = await getSsoAuth()
  return ssoLogin({
    ssoLoginUrl: config.ssoLoginUrl,
    platformId: config.platformId,
    callbackDomain: config.callbackDomain,
    callbackPort: config.callbackPort,
    serverName: '多语言 MCP Server',
    async exchangeToken(ssoToken: string) {
      return exchangeTokenWithOperate(config.operateBaseUrl, ssoToken)
    },
  })
}

/**
 * Exchange SSO token for operate platform session cookies and CSRF token.
 */
function exchangeTokenWithOperate(baseUrl: string, ssoToken: string): Promise<OperateCredentials> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + '/site/get-config')
    const mod = url.protocol === 'https:' ? https : http

    const options: http.RequestOptions = {
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
        } else {
          // Fallback: try to extract from meta tag or alternative pattern
          const altMatch = body.match(/value="([^"]+)"\s*>/)
          if (altMatch) csrfToken = altMatch[1]
        }

        if (!csrfToken) {
          reject(new Error(
            `Failed to extract CSRF token from operate platform. Status: ${res.statusCode}. ` +
            `Response length: ${body.length}. Try 'logout' then 'authenticate' again.`
          ))
          return
        }

        resolve({
          ssoToken,
          sessionCookie,
          csrfToken,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        })
      })
    })

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Session fetch timeout'))
    })
  })
}
