import type { OperateCredentials } from './operate-client.js';
export declare function loadCredentials(): Promise<OperateCredentials | null>;
export declare function saveCredentials(creds: OperateCredentials): Promise<void>;
export declare function clearCredentials(): Promise<void>;
export interface SsoConfig {
    operateBaseUrl: string;
}
/**
 * Launch a browser for the user to complete the full login flow
 * (SSO + zero-trust gateway), then extract all cookies and CSRF token.
 */
export declare function startSsoLogin(config: SsoConfig): Promise<OperateCredentials>;
