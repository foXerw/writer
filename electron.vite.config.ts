import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { resolve } from 'path'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 复制 monaco-editor 资源到输出目录
const monacoAssetsPlugin = () => {
  return {
    name: 'copy-monaco-assets',
    closeBuild() {
      const src = resolve(__dirname, 'node_modules/monaco-editor/min/vs')
      const dest = resolve(__dirname, 'dist-electron/renderer/monaco-editor/min/vs')
      if (existsSync(src)) {
        const destDir = resolve(__dirname, 'dist-electron/renderer/monaco-editor')
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true })
        }
        // 递归复制整个 vs 目录
        copyFolderRecursive(src, dest)
        console.log('Monaco assets copied to', dest)
      }
    }
  }
}

// 辅助函数：递归复制文件夹
function copyFolderRecursive(src: string, dest: string) {
  if (!existsSync(src)) return

  mkdirSync(dest, { recursive: true })

  const entries = require('fs').readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = resolve(src, entry.name)
    const destPath = resolve(dest, entry.name)

    if (entry.isDirectory()) {
      copyFolderRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main',
      lib: {
        entry: 'electron/main/index.ts',
        formats: ['cjs']
      },
      rollupOptions: {
        external: ['electron']
      }
    },
    resolve: {
      alias: {
        '@main': path.resolve(__dirname, './electron/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      lib: {
        entry: 'electron/preload/index.ts',
        formats: ['cjs']
      },
      rollupOptions: {
        external: ['electron']
      }
    },
    resolve: {
      alias: {
        '@preload': path.resolve(__dirname, './electron/preload')
      }
    }
  },
  renderer: {
    plugins: [react(), monacoAssetsPlugin()],
    build: {
      outDir: 'dist-electron/renderer'
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@renderer': path.resolve(__dirname, './src/renderer'),
        '@common': path.resolve(__dirname, './src/common')
      }
    },
    server: {
      headers: {
        'Content-Security-Policy': ''
      }
    }
  }
})
