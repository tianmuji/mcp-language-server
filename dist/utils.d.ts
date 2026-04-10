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
