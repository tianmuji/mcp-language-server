declare module 'mcp-sso-auth' {
  interface SsoLoginOptions {
    ssoLoginUrl: string
    platformId: string
    callbackDomain: string
    callbackPort: number
    serverName: string
    exchangeToken: (ssoToken: string) => Promise<any>
  }

  interface CredentialsManager {
    load(): any
    save(creds: any): void
    clear(): void
  }

  export function startSsoLogin(options: SsoLoginOptions): Promise<any>
  export function createCredentialsManager(name: string): CredentialsManager
}
