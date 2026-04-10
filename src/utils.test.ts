import { describe, it, expect } from 'vitest'
import {
  fixPlaceholders,
  extractStrings,
  mergeLocaleEntries,
  PLATFORM_MAP,
  LANGUAGE_LOCALE_MAP,
} from './utils'

// --- fixPlaceholders ---

describe('fixPlaceholders', () => {
  it('converts single %s to {0}', () => {
    expect(fixPlaceholders('已选择 %s 项')).toBe('已选择 {0} 项')
  })

  it('converts multiple %s with incrementing index', () => {
    expect(fixPlaceholders('从 %s 到 %s')).toBe('从 {0} 到 {1}')
  })

  it('converts three %s', () => {
    expect(fixPlaceholders('%s of %s (%s)')).toBe('{0} of {1} ({2})')
  })

  it('unescapes \\"', () => {
    expect(fixPlaceholders('say \\"hello\\"')).toBe('say "hello"')
  })

  it('unescapes \\n', () => {
    expect(fixPlaceholders('line1\\nline2')).toBe('line1\nline2')
  })

  it('handles combined %s and escape sequences', () => {
    expect(fixPlaceholders('%s said \\"hello\\n%s\\"'))
      .toBe('{0} said "hello\n{1}"')
  })

  it('returns string unchanged when no placeholders or escapes', () => {
    expect(fixPlaceholders('hello world')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(fixPlaceholders('')).toBe('')
  })
})

// --- extractStrings ---

describe('extractStrings', () => {
  const mockVersions = [
    {
      version_id: 100,
      version_number: '1.0.0',
      ar_language: ['1', '2'],
      ar_string: [
        {
          id: 'str1',
          keys: { '1': 'android_key', '4': 'web_key' },
          values: { '1': '确认', '2': 'Confirm' },
        },
        {
          id: 'str2',
          keys: { '4': 'cs_cancel' },
          values: { '1': '取消', '2': 'Cancel' },
        },
      ],
    },
  ]

  it('extracts strings by platform_id', () => {
    const result = extractStrings(mockVersions, '4')
    expect(result['1']).toEqual({ web_key: '确认', cs_cancel: '取消' })
    expect(result['2']).toEqual({ web_key: 'Confirm', cs_cancel: 'Cancel' })
  })

  it('uses different key for different platform', () => {
    const result = extractStrings(mockVersions, '1')
    expect(result['1']['android_key']).toBe('确认')
  })

  it('falls back to platform 0 key', () => {
    const versions = [{
      ar_language: ['1'],
      ar_string: [{
        id: 'x',
        keys: { '0': 'fallback_key' },
        values: { '1': '测试' },
      }],
    }]
    const result = extractStrings(versions, '4')
    expect(result['1']['fallback_key']).toBe('测试')
  })

  it('falls back to first available key', () => {
    const versions = [{
      ar_language: ['1'],
      ar_string: [{
        id: 'x',
        keys: { '3': 'ios_only_key' },
        values: { '1': '测试' },
      }],
    }]
    const result = extractStrings(versions, '4')
    expect(result['1']['ios_only_key']).toBe('测试')
  })

  it('skips strings with no keys', () => {
    const versions = [{
      ar_language: ['1'],
      ar_string: [{ id: 'x', keys: {}, values: { '1': '测试' } }],
    }]
    const result = extractStrings(versions, '4')
    expect(result).toEqual({})
  })

  it('skips languages with no value', () => {
    const versions = [{
      ar_language: ['1', '2'],
      ar_string: [{
        id: 'x',
        keys: { '4': 'k' },
        values: { '1': '中文' }, // no value for lang 2
      }],
    }]
    const result = extractStrings(versions, '4')
    expect(result['1']['k']).toBe('中文')
    expect(result['2']).toBeUndefined()
  })

  it('applies fixPlaceholders to values', () => {
    const versions = [{
      ar_language: ['1'],
      ar_string: [{
        id: 'x',
        keys: { '4': 'k' },
        values: { '1': '共 %s 个文件，已完成 %s' },
      }],
    }]
    const result = extractStrings(versions, '4')
    expect(result['1']['k']).toBe('共 {0} 个文件，已完成 {1}')
  })

  it('merges strings from multiple versions', () => {
    const versions = [
      {
        ar_language: ['1'],
        ar_string: [{ id: 'a', keys: { '4': 'key_a' }, values: { '1': 'A' } }],
      },
      {
        ar_language: ['1'],
        ar_string: [{ id: 'b', keys: { '4': 'key_b' }, values: { '1': 'B' } }],
      },
    ]
    const result = extractStrings(versions, '4')
    expect(result['1']).toEqual({ key_a: 'A', key_b: 'B' })
  })

  it('handles version with "strings" field instead of "ar_string"', () => {
    const versions = [{
      ar_language: ['1'],
      strings: [{ id: 'x', keys: { '4': 'k' }, values: { '1': '值' } }],
    }]
    const result = extractStrings(versions, '4')
    expect(result['1']['k']).toBe('值')
  })

  it('returns empty object for empty versions', () => {
    expect(extractStrings([], '4')).toEqual({})
  })
})

// --- mergeLocaleEntries ---

describe('mergeLocaleEntries', () => {
  it('adds new keys', () => {
    const existing = { a: '1' }
    const newEntries = { b: '2' }
    const { merged, keysAdded, keysUpdated } = mergeLocaleEntries(existing, newEntries)

    expect(merged).toEqual({ a: '1', b: '2' })
    expect(keysAdded).toEqual(['b'])
    expect(keysUpdated).toEqual([])
  })

  it('updates changed keys', () => {
    const existing = { a: 'old' }
    const newEntries = { a: 'new' }
    const { merged, keysAdded, keysUpdated } = mergeLocaleEntries(existing, newEntries)

    expect(merged.a).toBe('new')
    expect(keysAdded).toEqual([])
    expect(keysUpdated).toEqual(['a'])
  })

  it('reports no change for identical keys', () => {
    const existing = { a: 'same' }
    const newEntries = { a: 'same' }
    const { keysAdded, keysUpdated } = mergeLocaleEntries(existing, newEntries)

    expect(keysAdded).toEqual([])
    expect(keysUpdated).toEqual([])
  })

  it('fixes existing %s placeholders', () => {
    const existing = { old_key: '共 %s 项' }
    const newEntries = {}
    const { merged } = mergeLocaleEntries(existing, newEntries)

    expect(merged.old_key).toBe('共 {0} 项')
  })

  it('preserves insert_before_this_line marker at end', () => {
    const existing = {
      a: '1',
      insert_before_this_line: '---',
      b: '2',
    }
    const newEntries = { c: '3' }
    const { merged } = mergeLocaleEntries(existing, newEntries)

    const keys = Object.keys(merged)
    expect(keys[keys.length - 1]).toBe('insert_before_this_line')
    expect(merged.c).toBe('3')
  })

  it('works with empty existing object', () => {
    const { merged, keysAdded } = mergeLocaleEntries({}, { a: '1', b: '2' })

    expect(merged).toEqual({ a: '1', b: '2' })
    expect(keysAdded).toEqual(['a', 'b'])
  })

  it('works with empty new entries', () => {
    const { merged, keysAdded, keysUpdated } = mergeLocaleEntries({ a: '1' }, {})

    expect(merged).toEqual({ a: '1' })
    expect(keysAdded).toEqual([])
    expect(keysUpdated).toEqual([])
  })

  it('does not mutate original existing object', () => {
    const existing = { a: '1' }
    mergeLocaleEntries(existing, { a: '2', b: '3' })

    expect(existing).toEqual({ a: '1' })
  })
})

// --- Constants ---

describe('PLATFORM_MAP', () => {
  it('contains core platforms', () => {
    expect(PLATFORM_MAP[1]).toBe('Android')
    expect(PLATFORM_MAP[3]).toBe('iOS')
    expect(PLATFORM_MAP[4]).toBe('Web')
    expect(PLATFORM_MAP[8]).toBe('Harmony')
  })

  it('does not contain deprecated platforms', () => {
    expect(PLATFORM_MAP[2]).toBeUndefined() // BlackBerry
    expect(PLATFORM_MAP[6]).toBeUndefined() // WinPhone
  })
})

describe('LANGUAGE_LOCALE_MAP', () => {
  it('maps common language IDs to locale names', () => {
    expect(LANGUAGE_LOCALE_MAP['1']).toBe('ZhCn')
    expect(LANGUAGE_LOCALE_MAP['2']).toBe('EnUs')
    expect(LANGUAGE_LOCALE_MAP['7']).toBe('ZhTw')
  })

  it('has no mapping for undefined language ID 18', () => {
    expect(LANGUAGE_LOCALE_MAP['18']).toBeUndefined()
  })
})
