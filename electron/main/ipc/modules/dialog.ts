import { dialog, ipcMain } from 'electron'

export function registerDialogHandlers(): void {
  // 系统对话框
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('dialog:openFile', async (_, filters: { name: string; extensions: string[] }[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_, params: { defaultPath: string; filters?: { name: string; extensions: string[] }[] }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: params.defaultPath,
      filters: params.filters
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    return result.filePath
  })
}
