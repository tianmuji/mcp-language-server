export interface OperateCredentials {
    ssoToken: string;
    sessionCookie: string;
    csrfToken: string;
    expiresAt: number;
}
export declare class OperateClient {
    private baseUrl;
    private credentials;
    constructor(baseUrl: string);
    setCredentials(creds: OperateCredentials | null): void;
    isAuthenticated(): boolean;
    private postOnce;
    post(path: string, params: Record<string, string>, retries?: number): Promise<any>;
}
