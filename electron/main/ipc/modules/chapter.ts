import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { Chapter } from '../../../../src/common/ipc'
import { countWords } from '../../../../src/common/wordCount'

export function registerChapterHandlers(): void {
  // 章节相关处理
  ipcMain.handle('chapter:getAll', async (_, projectPath: string) => {
    const chaptersDir = path.join(projectPath, 'chapters')

    if (!fs.existsSync(chaptersDir)) {
      return []
    }

    const files = fs.readdirSync(chaptersDir)
      .filter(f => f.endsWith('.md'))
      .sort((a, b) => a.localeCompare(b))

    return files.map((file, index) => {
      const filePath = path.join(chaptersDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')

      // 从内容中提取标题（第一个 # 开头的内容）
      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1] : file.replace('.md', '')

      // 计算字数
      const wordCount = countWords(content)

      return {
        id: file.replace('.md', ''),
        title,
        content,
        order: index + 1,
        status: 'draft' as const,
        wordCount,
        createdAt: new Date(fs.statSync(filePath).ctime),
        updatedAt: new Date(fs.statSync(filePath).mtime)
      }
    })
  })

  ipcMain.handle('chapter:create', async (_, params: { projectPath: string; title: string }) => {
    const { projectPath, title } = params
    const chaptersDir = path.join(projectPath, 'chapters')

    if (!fs.existsSync(chaptersDir)) {
      fs.mkdirSync(chaptersDir, { recursive: true })
    }

    // 获取现有章节数量
    const existingFiles = fs.readdirSync(chaptersDir).filter(f => f.endsWith('.md'))
    const order = existingFiles.length + 1
    const id = `${order.toString().padStart(3, '0')}-${title}`
    const fileName = `${id}.md`

    const content = `# ${title}\n\n`
    const filePath = path.join(chaptersDir, fileName)

    fs.writeFileSync(filePath, content, 'utf-8')

    return {
      id,
      title,
      content,
      order,
      status: 'draft' as const,
      wordCount: countWords(content),
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })

  ipcMain.handle('chapter:update', async (_, params: { projectPath: string; chapter: Chapter }) => {
    const { projectPath, chapter } = params
    const chaptersDir = path.join(projectPath, 'chapters')
    const fileName = `${chapter.id}.md`
    const filePath = path.join(chaptersDir, fileName)

    fs.writeFileSync(filePath, chapter.content, 'utf-8')

    return {
      ...chapter,
      updatedAt: new Date()
    }
  })

  ipcMain.handle('chapter:delete', async (_, params: { projectPath: string; chapterId: string }) => {
    const { projectPath, chapterId } = params
    const chaptersDir = path.join(projectPath, 'chapters')
    const filePath = path.join(chaptersDir, `${chapterId}.md`)

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    return true
  })

  ipcMain.handle('chapter:rename', async (_, params: { projectPath: string; chapterId: string; newTitle: string }) => {
    const { projectPath, chapterId, newTitle } = params
    const chaptersDir = path.join(projectPath, 'chapters')
    const oldFilePath = path.join(chaptersDir, `${chapterId}.md`)

    if (!fs.existsSync(oldFilePath)) {
      throw new Error('章节文件不存在')
    }

    // 读取文件内容
    const content = fs.readFileSync(oldFilePath, 'utf-8')
    // 更新第一行的标题
    const lines = content.split('\n')
    if (lines.length > 0) {
      lines[0] = `# ${newTitle}`
    }
    const newContent = lines.join('\n')

    // 如果ID也变了，需要重命名文件
    const newId = `${chapterId.split('-')[0]}-${newTitle}`
    const newFilePath = path.join(chaptersDir, `${newId}.md`)

    fs.writeFileSync(newFilePath, newContent, 'utf-8')

    // 如果ID变了，删除旧文件
    if (newId !== chapterId) {
      fs.unlinkSync(oldFilePath)
    }

    return {
      id: newId,
      title: newTitle,
      content: newContent,
      order: parseInt(chapterId.split('-')[0]) || 0,
      status: 'draft' as const,
      wordCount: countWords(newContent),
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })

  ipcMain.handle('chapter:reorder', async (_, params: { projectPath: string; fromId: string; toId: string }) => {
    const { projectPath, fromId, toId } = params
    const chaptersDir = path.join(projectPath, 'chapters')

    if (!fs.existsSync(chaptersDir)) {
      return false
    }

    const files = fs.readdirSync(chaptersDir)
      .filter(f => f.endsWith('.md'))
      .sort((a, b) => a.localeCompare(b))

    const fromIndex = files.findIndex(f => f.replace('.md', '') === fromId)
    const toIndex = files.findIndex(f => f.replace('.md', '') === toId)

    if (fromIndex === -1 || toIndex === -1) {
      return false
    }

    // 交换文件顺序
    const [removed] = files.splice(fromIndex, 1)
    files.splice(toIndex, 0, removed)

    // 重命名文件以反映新顺序
    files.forEach((file, index) => {
      const oldPath = path.join(chaptersDir, file)
      const newName = `${(index + 1).toString().padStart(3, '0')}-${file.split('-').slice(1).join('-')}`
      const newPath = path.join(chaptersDir, newName)
      if (oldPath !== newPath) {
        fs.renameSync(oldPath, newPath)
      }
    })

    return true
  })

  ipcMain.handle('chapter:getById', async (_, params: { projectPath: string; chapterId: string }) => {
    const { projectPath, chapterId } = params
    const chaptersDir = path.join(projectPath, 'chapters')

    // 查找匹配的文件
    const files = fs.readdirSync(chaptersDir)
      .filter(f => f.endsWith('.md'))

    const file = files.find(f => {
      const id = f.replace('.md', '')
      return id === chapterId || id.startsWith(chapterId.split('-')[0])
    })

    if (!file) {
      return null
    }

    const filePath = path.join(chaptersDir, file)
    const content = fs.readFileSync(filePath, 'utf-8')

    const titleMatch = content.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1] : file.replace('.md', '')

    const wordCount = countWords(content)

    return {
      id: file.replace('.md', ''),
      title,
      content,
      order: parseInt(file.split('-')[0]) || 0,
      status: 'draft' as const,
      wordCount,
      createdAt: new Date(fs.statSync(filePath).ctime),
      updatedAt: new Date(fs.statSync(filePath).mtime)
    }
  })
}
