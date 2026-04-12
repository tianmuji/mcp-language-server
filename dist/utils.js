"use strict";
// --- Constants ---
Object.defineProperty(exports, "__esModule", { value: true });
exports.LANGUAGE_LOCALE_MAP = exports.PLATFORM_MAP = void 0;
exports.getLocaleName = getLocaleName;
exports.fixPlaceholders = fixPlaceholders;
exports.extractStrings = extractStrings;
exports.mergeLocaleEntries = mergeLocaleEntries;
exports.findMissingLocales = findMissingLocales;
exports.PLATFORM_MAP = {
    1: 'Android',
    3: 'iOS',
    4: 'Web',
    5: 'Windows',
    7: 'Market',
    8: 'Harmony',
    9: 'PC',
};
// 语言ID → locale 字符串映射（从 operate-main AppConfMacro::$ar_language_map 复制）
const LANGUAGE_STRING_MAP = {
    1: 'zh-cn', 2: 'en-us', 3: 'de-de', 4: 'fr-fr',
    5: 'ja-jp', 6: 'ko-kr', 7: 'zh-tw', 8: 'es-es',
    9: 'ru-ru', 10: 'sk-sk', 11: 'cs-cs', 12: 'pt-pt',
    13: 'pl-pl', 14: 'it-it', 15: 'tr-tr', 16: 'ar-ar',
    17: 'pt-br', 19: 'ag-ag', 20: 'sm-sm', 22: 'id-id',
    23: 'th-th', 24: 'fil-ph', 25: 'ms-my', 26: 'vi-vn',
    27: 'bn-bd', 28: 'fa-ir', 29: 'hi-in', 30: 'nl-nl',
    31: 'el-gr', 32: 'hu-hu', 33: 'uk-ua', 34: 'no-no',
    35: 'da-dk', 36: 'ur-pk', 37: 'hr-hr', 38: 'hy-am',
    39: 'bg-bg', 40: 'si-lk', 41: 'is-is', 42: 'kk-kz',
    43: 'sr-rs', 44: 'ne-np', 45: 'lv-lv', 46: 'sl-si',
    47: 'sw-ke', 48: 'ka-ge', 49: 'et-ee', 50: 'sv-se',
    51: 'be-by', 52: 'zu-za', 53: 'lt-lt', 54: 'my-mm',
    55: 'ro-ro', 56: 'lo-la', 57: 'mn-mn', 58: 'az-az',
    59: 'am-et', 60: 'sq-al', 61: 'mk-mk', 62: 'gl-es',
    63: 'ca-es', 64: 'af-za', 65: 'kn-in', 66: 'gu-in',
    67: 'eu-es', 68: 'iw-il', 69: 'pa-in', 70: 'ky-kg',
    71: 'te-in', 72: 'ta-in', 73: 'rm-ch', 74: 'mr-in',
    75: 'ml-in', 76: 'km-kh', 77: 'bs-ba', 78: 'lb-lu',
    79: 'rw-rw', 80: 'mt-mt', 81: 'uz-uz', 82: 'ga-ie',
};
// locale 字符串 → PascalCase 文件名（从 operate-main MacroExport::filter2 复制）
function toLocaleName(localeStr) {
    return localeStr.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}
// 特殊映射：项目 locale 文件名与 filter2 输出不一致的语言
const LOCALE_NAME_OVERRIDE = {
    16: 'ArSa', // filter2: ArAr → 实际: ArSa
    20: 'FiFi', // filter2: SmSm → 实际: FiFi (芬兰语)
    22: 'InId', // filter2: IdId → 实际: InId (印尼语)
    23: 'Th', // filter2: ThTh → 实际: Th (泰语)
    29: 'HiDi', // filter2: HiIn → 实际: HiDi (印地语)
    31: 'ElEl', // filter2: ElGr → 实际: ElEl (希腊语)
};
// 获取 locale 文件名（优先用 override，否则 filter2 动态生成）
function getLocaleName(langId) {
    const id = Number(langId);
    if (LOCALE_NAME_OVERRIDE[id])
        return LOCALE_NAME_OVERRIDE[id];
    const localeStr = LANGUAGE_STRING_MAP[id];
    if (!localeStr)
        return null;
    return toLocaleName(localeStr);
}
// 兼容旧接口：动态生成完整映射表
exports.LANGUAGE_LOCALE_MAP = Object.fromEntries(Object.keys(LANGUAGE_STRING_MAP).map(id => [String(id), getLocaleName(id)]).filter(([, v]) => v));
// --- Helpers ---
function fixPlaceholders(value) {
    let cnt = 0;
    return value
        .replace(/%s/g, () => `{${cnt++}}`)
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n');
}
function extractStrings(versions, platformId) {
    const result = {};
    for (const version of versions) {
        const strings = version.ar_string || version.strings || [];
        const languages = version.ar_language || [];
        for (const str of strings) {
            const key = str.keys?.[platformId] || str.keys?.['0'] || Object.values(str.keys || {})[0];
            if (!key)
                continue;
            for (const langId of languages) {
                const value = str.values?.[langId];
                if (!value)
                    continue;
                if (!result[langId])
                    result[langId] = {};
                result[langId][key] = fixPlaceholders(value);
            }
        }
    }
    return result;
}
function mergeLocaleEntries(existingObj, newEntries) {
    const merged = { ...existingObj };
    // Fix existing %s placeholders
    for (const key of Object.keys(merged)) {
        if (typeof merged[key] === 'string' && merged[key].includes('%s')) {
            merged[key] = fixPlaceholders(merged[key]);
        }
    }
    // Preserve insert_before_this_line marker
    const insertMarker = merged['insert_before_this_line'];
    delete merged['insert_before_this_line'];
    const keysAdded = [];
    const keysUpdated = [];
    for (const [key, value] of Object.entries(newEntries)) {
        if (merged[key] === undefined) {
            keysAdded.push(key);
        }
        else if (merged[key] !== value) {
            keysUpdated.push(key);
        }
        merged[key] = value;
    }
    if (insertMarker) {
        merged['insert_before_this_line'] = insertMarker;
    }
    return { merged, keysAdded, keysUpdated };
}
/**
 * 找出本地存在但远程未返回翻译的 locale 文件名。
 * @param localLocaleNames 本地存在的 locale 名称列表（不含 .json 后缀），如 ['ZhCn', 'EnUs', 'JaJp']
 * @param remoteLanguageIds 远程返回的语言 ID 列表，如 ['1', '2']
 * @returns 本地存在但远程无数据的 locale 名称列表
 */
function findMissingLocales(localLocaleNames, remoteLanguageIds) {
    const remoteLocaleNames = new Set(remoteLanguageIds.map(id => exports.LANGUAGE_LOCALE_MAP[id]).filter(Boolean));
    return localLocaleNames.filter(name => !remoteLocaleNames.has(name));
}
