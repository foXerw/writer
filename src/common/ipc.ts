// IPC通信类型定义

// 主进程 -> 渲染进程 事件
export type MainToRendererEvents = {
  'project:created': (project: ProjectData) => void
  'project:opened': (project: ProjectData) => void
  'file:saved': (filePath: string) => void
  'stats:updated': (stats: WritingStats) => void
}

// 渲染进程 -> 主进程 请求
export type RendererToMainRequests = {
  // 项目相关
  'project:create': (params: { name: string; path: string; type: ProjectType }) => Promise<ProjectData>
  'project:open': (path: string) => Promise<ProjectData>
  'project:getRecent': () => Promise<RecentProject[]>

  // 文件相关
  'file:read': (path: string) => Promise<string>
  'file:write': (params: { path: string; content: string }) => Promise<boolean>
  'file:delete': (path: string) => Promise<boolean>
  'file:exists': (path: string) => Promise<boolean>

  // 章节相关
  'chapter:getAll': (projectPath: string) => Promise<Chapter[]>
  'chapter:create': (params: { projectPath: string; title: string }) => Promise<Chapter>
  'chapter:update': (params: { projectPath: string; chapter: Chapter }) => Promise<Chapter>
  'chapter:delete': (params: { projectPath: string; chapterId: string }) => Promise<boolean>
  'chapter:rename': (params: { projectPath: string; chapterId: string; newTitle: string }) => Promise<Chapter>
  'chapter:reorder': (params: { projectPath: string; fromId: string; toId: string }) => Promise<boolean>
  'chapter:getById': (params: { projectPath: string; chapterId: string }) => Promise<Chapter | null>

  // 角色相关
  'character:getAll': (projectPath: string) => Promise<Character[]>
  'character:getById': (params: { projectPath: string; characterId: string }) => Promise<Character | null>
  'character:create': (params: { projectPath: string; character: Partial<Character> }) => Promise<Character>
  'character:update': (params: { projectPath: string; character: Character }) => Promise<Character>
  'character:delete': (params: { projectPath: string; characterId: string }) => Promise<boolean>

  // 世界观设定相关
  'setting:getAll': (projectPath: string) => Promise<Setting[]>
  'setting:getById': (params: { projectPath: string; settingId: string }) => Promise<Setting | null>
  'setting:create': (params: { projectPath: string; setting: Partial<Setting> }) => Promise<Setting>
  'setting:update': (params: { projectPath: string; setting: Setting }) => Promise<Setting>
  'setting:delete': (params: { projectPath: string; settingId: string }) => Promise<boolean>

  // 系统相关
  'dialog:openDirectory': () => Promise<string | null>
  'dialog:openFile': (filters: FileFilter[]) => Promise<string | null>
  'dialog:saveFile': (defaultPath: string) => Promise<string | null>
}

// 项目类型
export type ProjectType = 'novel' | 'script' | 'essay'

// 项目数据
export interface ProjectData {
  id: string
  name: string
  path: string
  type: ProjectType
  createdAt: Date
  updatedAt: Date
  config: ProjectConfig
}

// 项目配置
export interface ProjectConfig {
  wordCountGoal: number
  dailyGoal: number
  autoSave: boolean
  autoSaveInterval: number
}

// 最近项目
export interface RecentProject {
  id: string
  name: string
  path: string
  lastOpened: Date
}

// 章节
export interface Chapter {
  id: string
  title: string
  content: string
  order: number
  status: 'draft' | 'revising' | 'completed'
  wordCount: number
  createdAt: Date
  updatedAt: Date
}

// 写作统计
export interface WritingStats {
  dailyWordCount: number
  totalWordCount: number
  writingDuration: number
  streak: number
}

// 文件过滤器
export interface FileFilter {
  name: string
  extensions: string[]
}

// 角色性别
export type CharacterGender = 'male' | 'female' | 'other'

// 角色定位
export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting' | 'minor'

// 角色关系
export interface CharacterRelationship {
  id: string
  characterId: string
  characterName: string
  relationship: string
  description?: string
}

// 角色标签
export interface CharacterTag {
  id: string
  name: string
  color?: string
}

// 角色
export interface Character {
  id: string
  name: string
  gender: CharacterGender
  age: number
  role: CharacterRole
  avatar?: string
  appearance: string
  personality: string
  background: string
  goals?: string
  flaws?: string
  relationships: CharacterRelationship[]
  tags: CharacterTag[]
  notes?: string
  createdAt: Date
  updatedAt: Date
}

// 角色创建参数
export interface CharacterCreateParams {
  projectPath: string
  name: string
  gender: CharacterGender
  role: CharacterRole
}

// 世界观设定分类
export type SettingCategory = 'location' | 'history' | 'magic' | 'culture' | 'other'

// 世界观设定
export interface Setting {
  id: string
  title: string
  category: SettingCategory
  content: string
  parentId?: string
  order: number
  tags: string[]
  createdAt: Date
  updatedAt: Date
}
