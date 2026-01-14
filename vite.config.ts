import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 复制 monaco-editor 资源到输出目录
const monacoAssetsPlugin = () => {
  return {
    name: 'copy-monaco-assets',
    closeBuild() {
      const src = resolve(__dirname, 'node_modules/monaco-editor/min/vs')
      const dest = resolve(__dirname, 'dist/monaco-editor/min/vs')
      if (existsSync(src)) {
        const destDir = resolve(__dirname, 'dist/monaco-editor')
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true })
        }
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
  plugins: [react(), monacoAssetsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@common': path.resolve(__dirname, './src/common')
    }
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 3000,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  optimizeDeps: {
    include: ['monaco-editor', '@monaco-editor/react']
  }
})
