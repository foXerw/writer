import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'

let tray: Tray | null = null

export function createTray(): Tray | null {
  if (tray) {
    return tray
  }

  // 创建托盘图标
  const icon = nativeImage.createFromPath(
    join(__dirname, '../../resources/icons/tray.png')
  )

  // 如果图标文件不存在，使用空图标
  if (icon.isEmpty()) {
    // 创建一个简单的图标
    const emptyIcon = nativeImage.createEmpty()
    tray = new Tray(emptyIcon)
  } else {
    tray = new Tray(icon)
  }

  // 设置托盘提示
  tray.setToolTip('Novel Writer')

  // 创建托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.show()
          win.focus()
        }
      }
    },
    {
      label: '新建章节',
      click: () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send('menu:newChapter')
        }
      }
    },
    { type: 'separator' as const },
    {
      label: '今日字数',
      enabled: false
    },
    { type: 'separator' as const },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // 点击托盘图标显示窗口
  tray.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isVisible()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    }
  })

  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.show()
      win.focus()
    }
  })

  return tray
}

export function updateTrayMenu(stats?: { todayWordCount: number; streak: number }) {
  if (!tray) {
    return
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.show()
          win.focus()
        }
      }
    },
    {
      label: '新建章节',
      click: () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send('menu:newChapter')
        }
      }
    },
    { type: 'separator' as const },
    {
      label: `今日字数: ${stats?.todayWordCount ?? 0}`,
      enabled: false
    },
    {
      label: `连续写作: ${stats?.streak ?? 0} 天`,
      enabled: false
    },
    { type: 'separator' as const },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
}

export function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
