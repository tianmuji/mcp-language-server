export declare const PLATFORM_MAP: Record<number, string>;
export declare const LANGUAGE_LOCALE_MAP: Record<string, string>;
export declare function fixPlaceholders(value: string): string;
export declare function extractStrings(versions: any[], platformId: string): Record<string, Record<string, string>>;
export interface MergeResult {
    merged: Record<string, string>;
    keysAdded: string[];
    keysUpdated: string[];
}
export declare function mergeLocaleEntries(existingObj: Record<string, string>, newEntries: Record<string, string>): MergeResult;
/**
 * 找出本地存在但远程未返回翻译的 locale 文件名。
 * @param localLocaleNames 本地存在的 locale 名称列表（不含 .json 后缀），如 ['ZhCn', 'EnUs', 'JaJp']
 * @param remoteLanguageIds 远程返回的语言 ID 列表，如 ['1', '2']
 * @returns 本地存在但远程无数据的 locale 名称列表
 */
export declare function findMissingLocales(localLocaleNames: string[], remoteLanguageIds: string[]): string[];
