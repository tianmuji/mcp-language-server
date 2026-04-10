"use strict";
// --- Constants ---
Object.defineProperty(exports, "__esModule", { value: true });
exports.LANGUAGE_LOCALE_MAP = exports.PLATFORM_MAP = void 0;
exports.fixPlaceholders = fixPlaceholders;
exports.extractStrings = extractStrings;
exports.mergeLocaleEntries = mergeLocaleEntries;
exports.PLATFORM_MAP = {
    1: 'Android',
    3: 'iOS',
    4: 'Web',
    5: 'Windows',
    7: 'Market',
    8: 'Harmony',
    9: 'PC',
};
exports.LANGUAGE_LOCALE_MAP = {
    '1': 'ZhCn',
    '2': 'EnUs',
    '3': 'JaJp',
    '4': 'KoKr',
    '5': 'FrFr',
    '6': 'DeDe',
    '7': 'ZhTw',
    '8': 'PtBr',
    '9': 'EsEs',
    '10': 'ItIt',
    '11': 'RuRu',
    '12': 'TrTr',
    '13': 'ArSa',
    '14': 'ThTh',
    '15': 'PlPl',
    '16': 'ViVn',
    '17': 'InId',
    '19': 'MsMy',
    '20': 'NlNl',
    '22': 'HiDi',
    '23': 'BnBd',
    '24': 'CsCs',
    '25': 'SkSk',
    '26': 'FilPh',
    '27': 'ElEl',
    '28': 'PtPt',
    '29': 'RoRo',
};
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
