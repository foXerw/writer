import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { StatsData } from '../../../../src/common/ipc'

export function registerStatsHandlers(): void {
  // ==================== 写作统计相关 ====================
  ipcMain.handle('stats:get', async (_, projectPath: string): Promise<StatsData | null> => {
    const filePath = path.join(projectPath, '.novelwriter', 'stats.json')
    if (!fs.existsSync(filePath)) return null
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StatsData
    } catch (e) {
      console.error('stats:get 解析失败:', e)
      return null
    }
  })

  ipcMain.handle('stats:save', async (_, params: { projectPath: string; stats: StatsData }): Promise<boolean> => {
    try {
      const dir = path.join(params.projectPath, '.novelwriter')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(params.stats, null, 2), 'utf-8')
      return true
    } catch (e) {
      console.error('stats:save 失败:', e)
      return false
    }
  })
}
