import type { OperateCredentials } from './operate-client.js';
export declare function loadCredentials(): Promise<OperateCredentials | null>;
export declare function saveCredentials(creds: OperateCredentials): Promise<void>;
export declare function clearCredentials(): Promise<void>;
export interface SsoConfig {
    ssoLoginUrl: string;
    platformId: string;
    callbackDomain: string;
    callbackPort: number;
    operateBaseUrl: string;
}
export declare function startSsoLogin(config: SsoConfig): Promise<OperateCredentials>;
