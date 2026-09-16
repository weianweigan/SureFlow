import { resolve } from 'node:path'
import { cpSync } from 'node:fs'
import type { Plugin } from 'vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 构建时把 build/ 下的应用图标复制到 out/main/，
 * 主进程即可用 join(__dirname, 'icon.ico') 引用同级文件，无需回溯工程根目录。
 * （electron-vite 对 main 构建强制 copyPublicDir=false，publicDir 方案不可用）
 */
function copyAppIcons(): Plugin {
  return {
    name: 'copy-app-icons',
    closeBundle() {
      cpSync(resolve('build'), resolve('out/main'), { recursive: true })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyAppIcons()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    optimizeDeps: {
      include: ['manifold-3d'],
      exclude: ['@bitbybit-dev/occt']
    },
    plugins: [react(), tailwindcss()]
  }
})
