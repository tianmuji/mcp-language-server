import http from 'http'
import https from 'https'
import { URL } from 'url'

export interface OperateCredentials {
  ssoToken: string
  sessionCookie: string
  csrfToken: string
  expiresAt: number
}

export class OperateClient {
  private baseUrl: string
  private credentials: OperateCredentials | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  setCredentials(creds: OperateCredentials | null): void {
    this.credentials = creds
  }

  isAuthenticated(): boolean {
    return !!(this.credentials && Date.now() < this.credentials.expiresAt)
  }

  private postOnce(path: string, params: Record<string, string>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.credentials) {
        reject(new Error("Not authenticated. Please call the 'authenticate' tool first."))
        return
      }

      const url = new URL(this.baseUrl + path)
      const mod = url.protocol === 'https:' ? https : http
      const body = new URLSearchParams(params).toString()

      const options: http.RequestOptions = {
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
      }

      const req = mod.request(url.toString(), options, (res) => {
        if (res.statusCode === 302) {
          res.resume()
          reject(new Error("Authentication expired (302 redirect). Please call 'authenticate' to re-login."))
          return
        }

        let respBody = ''
        res.on('data', (chunk) => (respBody += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(respBody))
          } catch {
            reject(new Error(`Invalid JSON response from ${path}: ${respBody.substring(0, 300)}`))
          }
        })
      })

      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error(`Request timeout: ${path}`))
      })

      req.write(body)
      req.end()
    })
  }

  async post(path: string, params: Record<string, string>, retries = 2): Promise<any> {
    for (let i = 0; i <= retries; i++) {
      try {
        return await this.postOnce(path, params)
      } catch (err: any) {
        if (i === retries || !err.message?.includes('timeout')) throw err
        console.error(`[Operate] Retry ${i + 1}/${retries} for ${path}: ${err.message}`)
      }
    }
    throw new Error(`Request failed after ${retries} retries: ${path}`)
  }
}
