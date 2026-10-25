import { ipcMain } from 'electron'
import { setCurrentTheme } from '../../theme'

export function registerThemeHandlers(): void {
  // ==================== 主题相关 ====================

  ipcMain.handle('theme:set', (_event, mode: 'dark' | 'light') => {
    setCurrentTheme(mode)
    return true
  })
}
