import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { Setting } from '../../../../src/common/ipc'

// ==================== 世界观设定相关处理 ====================

// 获取设定目录路径
function getSettingsDir(projectPath: string): string {
  return path.join(projectPath, 'settings')
}

export function registerSettingHandlers(): void {
  // 获取所有设定
  ipcMain.handle('setting:getAll', async (_, projectPath: string) => {
    const settingsDir = getSettingsDir(projectPath)

    if (!fs.existsSync(settingsDir)) {
      return []
    }

    // 递归读取所有JSON文件
    const readSettingsRecursive = (dir: string): Setting[] => {
      const results: Setting[] = []
      if (!fs.existsSync(dir)) return results

      const files = fs.readdirSync(dir)
      files.forEach(file => {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)

        if (stat.isDirectory()) {
          results.push(...readSettingsRecursive(filePath))
        } else if (file.endsWith('.json')) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8')
            const setting = JSON.parse(content)
            // 计算相对路径作为parentId
            const relativePath = path.relative(settingsDir, filePath)
            setting.parentId = path.dirname(relativePath) === '.' ? undefined : path.dirname(relativePath)
            results.push(setting)
          } catch {
            // 忽略解析错误
          }
        }
      })

      return results
    }

    return readSettingsRecursive(settingsDir)
  })

  // 获取单个设定
  ipcMain.handle('setting:getById', async (_, params: { projectPath: string; settingId: string }) => {
    const { projectPath, settingId } = params
    const settingsDir = getSettingsDir(projectPath)

    // 查找文件
    const findSetting = (dir: string): Setting | null => {
      if (!fs.existsSync(dir)) return null

      const files = fs.readdirSync(dir)
      for (const file of files) {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)

        if (stat.isDirectory()) {
          const found = findSetting(filePath)
          if (found) return found
        } else if (file.endsWith('.json') && file.replace('.json', '') === settingId) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8')
            return JSON.parse(content)
          } catch {
            return null
          }
        }
      }

      return null
    }

    return findSetting(settingsDir)
  })

  // 创建设定
  ipcMain.handle('setting:create', async (_, params: { projectPath: string; setting: Partial<Setting> }) => {
    const { projectPath, setting } = params
    const settingsDir = getSettingsDir(projectPath)

    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true })
    }

    const id = randomUUID()
    const category = setting.category || 'other'

    // 根据分类创建子目录
    const categoryDir = path.join(settingsDir, category)
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true })
    }

    const newSetting: Setting = {
      id,
      title: setting.title || '未命名设定',
      category,
      content: setting.content || '',
      parentId: setting.parentId,
      order: setting.order || 0,
      tags: setting.tags || [],
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const fileName = `${id}-${newSetting.title}.json`.replace(/[^a-zA-Z0-9\-_.]/g, '_')
    const filePath = path.join(categoryDir, fileName)
    fs.writeFileSync(filePath, JSON.stringify(newSetting, null, 2))

    return newSetting
  })

  // 更新设定
  ipcMain.handle('setting:update', async (_, params: { projectPath: string; setting: Setting }) => {
    const { projectPath, setting } = params
    const settingsDir = getSettingsDir(projectPath)

    const updatedSetting: Setting = {
      ...setting,
      updatedAt: new Date()
    }

    // 根据分类和ID查找并更新文件
    const findAndUpdate = (dir: string): boolean => {
      if (!fs.existsSync(dir)) return false

      const files = fs.readdirSync(dir)
      for (const file of files) {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)

        if (stat.isDirectory()) {
          if (findAndUpdate(filePath)) return true
        } else if (file.endsWith('.json') && file.startsWith(setting.id.substring(0, 8))) {
          fs.writeFileSync(filePath, JSON.stringify(updatedSetting, null, 2))
          return true
        }
      }

      return false
    }

    findAndUpdate(settingsDir)

    return updatedSetting
  })

  // 删除设定
  ipcMain.handle('setting:delete', async (_, params: { projectPath: string; settingId: string }) => {
    const { projectPath, settingId } = params
    const settingsDir = getSettingsDir(projectPath)

    // 查找并删除文件
    const findAndDelete = (dir: string): boolean => {
      if (!fs.existsSync(dir)) return false

      const files = fs.readdirSync(dir)
      for (const file of files) {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)

        if (stat.isDirectory()) {
          if (findAndDelete(filePath)) return true
        } else if (file.endsWith('.json') && file.startsWith(settingId.substring(0, 8))) {
          fs.unlinkSync(filePath)
          return true
        }
      }

      return false
    }

    findAndDelete(settingsDir)

    return true
  })
}
