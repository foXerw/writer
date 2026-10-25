import { BrowserWindow, BrowserWindowConstructorOptions, shell } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { join } from 'path'
import { getThemeBackgroundColor, getThemeTitleBarColor, getThemeTitleBarSymbolColor } from './theme'

// 存储主窗口引用
let mainWindow: BrowserWindow | null = null

// 获取主窗口
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// 创建主窗口
export function createMainWindow(): BrowserWindow {
  // 窗口状态管理
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800
  })

  const browserOptions: BrowserWindowConstructorOptions = {
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: getThemeBackgroundColor(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: getThemeTitleBarColor(),
      symbolColor: getThemeTitleBarSymbolColor(),
      height: 32
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js')
    }
  }

  mainWindow = new BrowserWindow(browserOptions)

  // 加载渲染进程
  if (import.meta.env.DEV) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 保存窗口状态
  mainWindowState.manage(mainWindow)

  // 窗口事件处理
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 打开外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return mainWindow
}

// 创建窗口（通用函数）
export function createWindow() {
  return createMainWindow()
}
