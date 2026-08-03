import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export type ThemeMode = 'dark' | 'light'

const themeFilePath = (): string => path.join(app.getPath('userData'), 'theme.json')

let currentTheme: ThemeMode = 'dark'

// 启动时从 userData/theme.json 读取持久化主题
export function loadTheme(): void {
  try {
    const raw = fs.readFileSync(themeFilePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    currentTheme = parsed?.mode === 'light' ? 'light' : 'dark'
  } catch {
    currentTheme = 'dark'
  }
}

export function getCurrentTheme(): ThemeMode {
  return currentTheme
}

export function getThemeBackgroundColor(): string {
  return currentTheme === 'light' ? '#f5f5f5' : '#1e1e1e'
}

export function getThemeTitleBarColor(): string {
  return currentTheme === 'light' ? '#ffffff' : '#252526'
}

export function getThemeTitleBarSymbolColor(): string {
  return currentTheme === 'light' ? '#000000' : '#ffffff'
}

// 渲染进程切换主题时：更新内存值、落盘、刷新所有已开窗口
export function setCurrentTheme(mode: ThemeMode): void {
  currentTheme = mode
  try {
    fs.writeFileSync(themeFilePath(), JSON.stringify({ mode }), 'utf-8')
  } catch (e) {
    console.error('Failed to persist theme:', e)
  }
  const bgColor = getThemeBackgroundColor()
  const titleColor = getThemeTitleBarColor()
  const symbolColor = getThemeTitleBarSymbolColor()
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(bgColor)
    // setTitleBarOverlay 仅 Windows 生效，其他平台静默忽略
    win.setTitleBarOverlay?.({ color: titleColor, symbolColor })
  }
}
