import { ipcMain } from 'electron'
import * as fs from 'fs'

export function registerFileHandlers(): void {
  // 文件相关处理
  ipcMain.handle('file:read', async (_, filePath: string) => {
    if (!fs.existsSync(filePath)) {
      throw new Error('文件不存在')
    }
    return fs.readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle('file:write', async (_, params: { path: string; content: string }) => {
    try {
      fs.writeFileSync(params.path, params.content, 'utf-8')
      return true
    } catch (error) {
      console.error('文件写入失败:', error)
      return false
    }
  })

  ipcMain.handle('file:delete', async (_, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      return true
    } catch (error) {
      console.error('文件删除失败:', error)
      return false
    }
  })

  ipcMain.handle('file:exists', async (_, filePath: string) => {
    return fs.existsSync(filePath)
  })
}
