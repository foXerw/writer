import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { createMainWindow } from './window'
import { setApplicationMenu } from './menu'
import { createTray, destroyTray } from './tray'
import { loadTheme } from './theme'
import { migrateUserData } from './userData'
import './ipc/handlers'

// M4a G8 安全硬化：dev 环境的 disable-web-security / allow-running-insecure-content /
// allow-file-access-from-files 三开关已移除（渲染进程无任何跨源/混合内容/file→fetch 需求：
// 所有 IO 走 IPC；monaco 未配置 worker，主线程回退；导出临时 HTML 自包含）。

app.whenReady().then(() => {
  // 更名搬运 novel-writer → perfect-novel：必须在 loadTheme() 与 createMainWindow() 之前，
  // 否则 theme.json / 窗口状态会读旧目录缺失而被静默重置
  migrateUserData(
    join(app.getPath('appData'), 'novel-writer'),
    join(app.getPath('appData'), 'perfect-novel')
  )

  // 启动时加载持久化主题（必须在创建窗口之前，确保首帧 backgroundColor 正确）
  loadTheme()

  // 创建主窗口
  createMainWindow()

  // 设置应用菜单
  setApplicationMenu({
    isMac: process.platform === 'darwin'
  })

  // 创建系统托盘
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

// 窗口全部关闭时（非macOS）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    destroyTray()
    app.quit()
  }
})

// 应用退出前清理
app.on('will-quit', () => {
  destroyTray()
})
