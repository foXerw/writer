import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { setApplicationMenu } from './menu'
import { createTray, destroyTray } from './tray'
import './ipc/handlers'

// 开发环境禁用安全限制
if (import.meta.env.DEV) {
  app.commandLine.appendSwitch('disable-web-security')
  app.commandLine.appendSwitch('allow-running-insecure-content')
  app.commandLine.appendSwitch('allow-file-access-from-files')
}

app.whenReady().then(() => {
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
