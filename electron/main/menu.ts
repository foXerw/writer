import { app, Menu, BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { createSettingsWindow } from './window'

interface MenuOptions {
  isMac: boolean
}

export function createMenu(options: MenuOptions): Menu {
  const { isMac } = options

  const template: MenuItemConstructorOptions[] = [
    // macOS应用菜单
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    // 文件菜单
    {
      label: '文件',
      submenu: [
        {
          label: '新建项目',
          accelerator: 'CommandOrControl+Shift+N',
          click: () => {
            // 发送事件到渲染进程处理
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:newProject')
            }
          }
        },
        {
          label: '新建章节',
          accelerator: 'CommandOrControl+N',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:newChapter')
            }
          }
        },
        { type: 'separator' as const },
        { role: 'openFile' as const },
        { role: 'openRecent' as const, enabled: false },
        { type: 'separator' as const },
        {
          label: '保存',
          accelerator: 'CommandOrControl+S',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:save')
            }
          }
        },
        {
          label: '另存为',
          accelerator: 'CommandOrControl+Shift+S',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:saveAs')
            }
          }
        },
        { role: 'saveAll' as const, enabled: false },
        { type: 'separator' as const },
        ...(isMac ? [{ role: 'closeWindow' as const }] : [{ role: 'quit' as const }])
      ]
    },
    // 编辑菜单
    {
      label: '编辑',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
              { type: 'separator' as const },
              {
                label: '查找',
                accelerator: 'CommandOrControl+F',
                click: () => {
                  const win = BrowserWindow.getAllWindows()[0]
                  if (win) {
                    win.webContents.send('menu:find')
                  }
                }
              },
              {
                label: '替换',
                accelerator: 'CommandOrControl+H',
                click: () => {
                  const win = BrowserWindow.getAllWindows()[0]
                  if (win) {
                    win.webContents.send('menu:replace')
                  }
                }
              }
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const }
            ])
      ]
    },
    // 查看菜单
    {
      label: '查看',
      submenu: [
        {
          label: '大纲',
          accelerator: 'CommandOrControl+Shift+O',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:toggleOutline')
            }
          }
        },
        {
          label: '章节树',
          accelerator: 'CommandOrControl+Shift+E',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:toggleChapterTree')
            }
          }
        },
        { type: 'separator' as const },
        {
          label: '专注模式',
          accelerator: 'F11',
          type: 'checkbox' as const,
          checked: false,
          click: (menuItem) => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:focusMode', menuItem.checked)
            }
          }
        },
        {
          label: '打字机模式',
          accelerator: 'CommandOrControl+T',
          type: 'checkbox' as const,
          checked: false,
          click: (menuItem) => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:typewriterMode', menuItem.checked)
            }
          }
        },
        { type: 'separator' as const },
        { role: 'toggleDevTools' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    // 写作菜单
    {
      label: '写作',
      submenu: [
        {
          label: '上一章',
          accelerator: 'CommandOrControl+Up',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:prevChapter')
            }
          }
        },
        {
          label: '下一章',
          accelerator: 'CommandOrControl+Down',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:nextChapter')
            }
          }
        },
        { type: 'separator' as const },
        {
          label: '字数统计',
          accelerator: 'CommandOrControl+Shift+W',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:wordCount')
            }
          }
        },
        {
          label: '今日写作',
          accelerator: 'CommandOrControl+Shift+D',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:dailyStats')
            }
          }
        }
      ]
    },
    // 工具菜单
    {
      label: '工具',
      submenu: [
        {
          label: '角色卡片',
          accelerator: 'CommandOrControl+1',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:characters')
            }
          }
        },
        {
          label: '世界观设定',
          accelerator: 'CommandOrControl+2',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:settings')
            }
          }
        },
        {
          label: '情节线索',
          accelerator: 'CommandOrControl+3',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:plot')
            }
          }
        },
        { type: 'separator' as const },
        {
          label: '导出项目',
          accelerator: 'CommandOrControl+E',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:export')
            }
          }
        }
      ]
    },
    // 帮助菜单
    {
      label: '帮助',
      submenu: [
        {
          label: '文档',
          accelerator: 'F1',
          click: async () => {
            const { shell } = await import('electron')
            await shell.openExternal('https://github.com/your-repo/novel-writer')
          }
        },
        { type: 'separator' as const },
        {
          label: '快捷键参考',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:shortcuts')
            }
          }
        },
        { type: 'separator' as const },
        {
          label: '关于 Novel Writer',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:about')
            }
          }
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}

// 应用菜单
export function setApplicationMenu(options: MenuOptions) {
  const menu = createMenu(options)
  Menu.setApplicationMenu(menu)
}
