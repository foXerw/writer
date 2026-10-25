import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { ProjectType } from '../../../../src/common/ipc'
import { formatFilePath } from '../helpers'

export function registerProjectHandlers(): void {
  // 项目相关处理
  ipcMain.handle('project:create', async (_, params: { name: string; path: string; type: ProjectType }) => {
    const { name, path: projectPath, type } = params
    const projectDir = path.join(projectPath, name)

    // 创建项目目录
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true })
    }

    // 创建项目配置
    const config = {
      name,
      type,
      version: '1.0.0',
      settings: {
        wordCountGoal: 0,
        dailyGoal: 2000,
        autoSave: true,
        autoSaveInterval: 30000
      }
    }

    fs.writeFileSync(
      path.join(projectDir, '.novelwriter.json'),
      JSON.stringify(config, null, 2)
    )

    // 创建章节目录
    fs.mkdirSync(path.join(projectDir, 'chapters'), { recursive: true })

    const projectData = {
      id: randomUUID(),
      name,
      path: formatFilePath(projectDir),
      type,
      createdAt: new Date(),
      updatedAt: new Date(),
      config: config.settings
    }

    return projectData
  })

  ipcMain.handle('project:open', async (_, projectPath: string) => {
    const configPath = path.join(projectPath, '.novelwriter.json')

    if (!fs.existsSync(configPath)) {
      throw new Error('INVALID_PROJECT: Project configuration file not found. Please select a valid Novel Writer project folder.')
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

    return {
      id: randomUUID(),
      name: config.name,
      path: formatFilePath(projectPath),
      type: config.type,
      createdAt: new Date(),
      updatedAt: new Date(),
      config: config.settings
    }
  })
}
