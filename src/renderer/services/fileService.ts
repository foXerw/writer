// 文件服务 - 处理本地文件操作

import type { Chapter, ProjectData } from '../common/ipc'

// 生成唯一ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// 项目配置
export interface ProjectConfig {
  name: string
  type: 'novel' | 'script' | 'essay'
  wordCountGoal: number
  dailyGoal: number
  autoSave: boolean
  autoSaveInterval: number
}

// 项目结构
export interface ProjectStructure {
  config: ProjectConfig
  chapters: Chapter[]
}

// 默认项目配置
export const defaultProjectConfig: ProjectConfig = {
  name: '新项目',
  type: 'novel',
  wordCountGoal: 100000,
  dailyGoal: 2000,
  autoSave: true,
  autoSaveInterval: 30000 // 30秒
}

// 创建新项目结构
export function createProjectStructure(config: Partial<ProjectConfig>): ProjectStructure {
  return {
    config: { ...defaultProjectConfig, ...config },
    chapters: []
  }
}

// 章节文件名（带序号）
export function getChapterFileName(chapter: Chapter, index: number): string {
  const num = String(index + 1).padStart(2, '0')
  const title = chapter.title || `第${num}章`
  // 过滤非法文件名字符
  const safeTitle = title.replace(/[<>:"/\\|?*]/g, '')
  return `${num}-${safeTitle}.md`
}

// 解析章节文件名获取序号
export function parseChapterFileName(fileName: string): number | null {
  const match = fileName.match(/^(\d+)-/)
  return match ? parseInt(match[1], 10) - 1 : null
}

// 判断是否是章节文件
export function isChapterFile(fileName: string): boolean {
  return /^\d+-[^/\\:*?"<>|]+\.md$/.test(fileName)
}

// 判断是否是项目文件夹
export function isProjectFolder(path: string): boolean {
  const fs = require('fs')
  try {
    const configPath = `${path}/.novelwriter/config.json`
    return fs.existsSync(configPath)
  } catch {
    return false
  }
}

// 路径工具函数
export function pathJoin(...parts: string[]): string {
  return parts.filter(p => p).join('/').replace(/\/+/g, '/')
}

export function pathDirname(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/')
}

export function pathBasename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1]
}
