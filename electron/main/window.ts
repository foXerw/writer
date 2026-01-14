import { app, screen, BrowserWindow, BrowserWindowConstructorOptions, ipcMain, shell } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { join } from 'path'

// 存储主窗口引用
let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null

// 获取主窗口
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// 获取设置窗口
export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow
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
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#252526',
      symbolColor: '#ffffff',
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

// 创建设置窗口
export function createSettingsWindow(): BrowserWindow {
  if (settingsWindow) {
    settingsWindow.focus()
    return settingsWindow
  }

  const settingsWindowState = windowStateKeeper({
    defaultWidth: 800,
    defaultHeight: 600,
    file: 'settings-window-state.json'
  })

  const browserOptions: BrowserWindowConstructorOptions = {
    x: settingsWindowState.x,
    y: settingsWindowState.y,
    width: settingsWindowState.width,
    height: settingsWindowState.height,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1e1e1e',
    title: '设置 - Novel Writer',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#252526',
      symbolColor: '#ffffff',
      height: 32
    },
    parent: mainWindow ?? undefined,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js')
    }
  }

  settingsWindow = new BrowserWindow(browserOptions)

  // 加载设置页面
  if (import.meta.env.DEV) {
    settingsWindow.loadURL('http://localhost:5173/settings')
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: '/settings'
    })
  }

  settingsWindow.webContents.openDevTools()

  // 窗口事件处理
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  // 保存窗口状态
  settingsWindowState.manage(settingsWindow)

  return settingsWindow
}

// 创建窗口（通用函数）
export function createWindow() {
  return createMainWindow()
}
