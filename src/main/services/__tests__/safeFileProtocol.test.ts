import { describe, it, expect } from 'vitest'
import { resolveSfFilePath } from '../safeFileProtocol'

describe('safeFileProtocol', () => {
  it('correctly resolves standard sf-file://local/ URL on posix', () => {
    const raw = 'sf-file://local/Volumes/data-storage/docs/GB2877-2007.pdf'
    const result = resolveSfFilePath(raw)
    expect(result).toBe('/Volumes/data-storage/docs/GB2877-2007.pdf')
  })

  it('correctly recovers from mangled URL without host (e.g. sf-file://volumes/...)', () => {
    const mangled = 'sf-file://volumes/data-storage/docs/GB2877-2007.pdf'
    const result = resolveSfFilePath(mangled)
    expect(result.toLowerCase()).toBe('/volumes/data-storage/docs/gb2877-2007.pdf')
  })

  it('correctly decodes special characters and spaces in path', () => {
    const raw = 'sf-file://local/Volumes/data%20storage/docs/test%231%3F.pdf'
    const result = resolveSfFilePath(raw)
    expect(result).toBe('/Volumes/data storage/docs/test#1?.pdf')
  })

  it('handles windows drive letter URLs', () => {
    const raw = 'sf-file://local/C:/Users/test/docs/file.pdf'
    const result = resolveSfFilePath(raw)
    if (process.platform === 'win32') {
      expect(result).toBe('C:/Users/test/docs/file.pdf')
    } else {
      expect(result).toBe('/C:/Users/test/docs/file.pdf')
    }
  })
})
