/**
 * OCCT (OpenCASCADE Technology) WASM 内核加载器
 * 统一管理 OCCT 模块单例实例化，安全适配 Vite 资源管线与本地/Node 运行环境
 */

import MainModuleFactory from '@bitbybit-dev/occt/bitbybit-dev-occt/bitbybit-dev-occt'
import occtWasmUrl from '@bitbybit-dev/occt/bitbybit-dev-occt/bitbybit-dev-occt.a4a6ec2a.wasm?url'

let occInstance: any = null
let occInitPromise: Promise<any> | null = null

export async function getOccInstance(): Promise<any> {
  if (occInstance) return occInstance
  if (!occInitPromise) {
    occInitPromise = (async () => {
      const isNode =
        typeof process !== 'undefined' &&
        process.versions?.node &&
        (process as any).type !== 'renderer'

      const options = isNode
        ? {}
        : {
            locateFile: (path: string) => {
              if (path.endsWith('.wasm')) {
                return occtWasmUrl
              }
              return path
            }
          }

      const occ = await (MainModuleFactory as any)(options)
      occInstance = occ
      return occ
    })()
  }
  return occInitPromise
}
