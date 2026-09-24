import { describe, it, expect } from 'vitest'
import { detectInstalledCad } from '../cadDetector'

describe('cadDetector', () => {
  it('should detect installed CAD software and return formatted response', async () => {
    const res = await detectInstalledCad(true)
    expect(res).toBeDefined()
    expect(res.detectedMap).toBeDefined()
    expect(Array.isArray(res.installedList)).toBe(true)

    // 在 Windows 环境下应能成功探测出已安装的 SolidWorks / NX 等
    if (process.platform === 'win32') {
      const sw = res.installedList.find((c) => c.id === 'solidworks')
      if (sw) {
        expect(sw.installed).toBe(true)
        expect(sw.name).toContain('SolidWorks')
        expect(res.detectedMap.solidworks.installed).toBe(true)
      }
    }
  })
})
