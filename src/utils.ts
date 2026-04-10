// --- Constants ---

export const PLATFORM_MAP: Record<number, string> = {
  1: 'Android',
  3: 'iOS',
  4: 'Web',
  5: 'Windows',
  7: 'Market',
  8: 'Harmony',
  9: 'PC',
}

export const LANGUAGE_LOCALE_MAP: Record<string, string> = {
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
}

// --- Helpers ---

export function fixPlaceholders(value: string): string {
  let cnt = 0
  return value
    .replace(/%s/g, () => `{${cnt++}}`)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
}

export function extractStrings(versions: any[], platformId: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  for (const version of versions) {
    const strings = version.ar_string || version.strings || []
    const languages: string[] = version.ar_language || []
    for (const str of strings) {
      const key = str.keys?.[platformId] || str.keys?.['0'] || Object.values(str.keys || {})[0] as string
      if (!key) continue
      for (const langId of languages) {
        const value = str.values?.[langId]
        if (!value) continue
        if (!result[langId]) result[langId] = {}
        result[langId][key] = fixPlaceholders(value)
      }
    }
  }
  return result
}

export interface MergeResult {
  merged: Record<string, string>
  keysAdded: string[]
  keysUpdated: string[]
}

export function mergeLocaleEntries(
  existingObj: Record<string, string>,
  newEntries: Record<string, string>,
): MergeResult {
  const merged = { ...existingObj }

  // Fix existing %s placeholders
  for (const key of Object.keys(merged)) {
    if (typeof merged[key] === 'string' && merged[key].includes('%s')) {
      merged[key] = fixPlaceholders(merged[key])
    }
  }

  // Preserve insert_before_this_line marker
  const insertMarker = merged['insert_before_this_line']
  delete merged['insert_before_this_line']

  const keysAdded: string[] = []
  const keysUpdated: string[] = []
  for (const [key, value] of Object.entries(newEntries)) {
    if (merged[key] === undefined) {
      keysAdded.push(key)
    } else if (merged[key] !== value) {
      keysUpdated.push(key)
    }
    merged[key] = value
  }

  if (insertMarker) {
    merged['insert_before_this_line'] = insertMarker
  }

  return { merged, keysAdded, keysUpdated }
}
