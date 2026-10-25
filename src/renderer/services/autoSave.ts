// 自动保存（渲染进程本地定时器，非 IPC）——自原通用服务层文件原样迁移，Task 7 将替换其实现。

interface AutoSaveOptions {
  interval: number
  onSave: () => string // 返回当前内容；调用方在内部决定是否真正写盘
}

let autoSaveTimer: ReturnType<typeof setInterval> | null = null
let lastContent: string = ''

export function startAutoSave(options: AutoSaveOptions): void {
  stopAutoSave()
  lastContent = ''
  autoSaveTimer = setInterval(() => {
    const currentContent = options.onSave()
    if (currentContent !== lastContent) {
      lastContent = currentContent
    }
  }, options.interval)
}

export function stopAutoSave(): void {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer)
    autoSaveTimer = null
  }
}
