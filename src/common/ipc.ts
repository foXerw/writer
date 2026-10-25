// IPC通信类型定义

// 主进程 -> 渲染进程 事件
export type MainToRendererEvents = {
  'project:created': (project: ProjectData) => void
  'project:opened': (project: ProjectData) => void
  'file:saved': (filePath: string) => void
  'stats:updated': (stats: WritingStats) => void
  'menu:event': (event: string, ...args: unknown[]) => void
}

// 渲染进程 -> 主进程 请求
export type RendererToMainRequests = {
  // 项目相关
  'project:create': (params: { name: string; path: string; type: ProjectType }) => Promise<ProjectData>
  'project:open': (path: string) => Promise<ProjectData>

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
  'dialog:saveFile': (params: { defaultPath: string; filters?: FileFilter[] }) => Promise<string | null>

  // 主题相关
  'theme:set': (mode: 'dark' | 'light') => Promise<boolean>

  // 写作统计相关
  'stats:get': (projectPath: string) => Promise<StatsData | null>
  'stats:save': (params: { projectPath: string; stats: StatsData }) => Promise<boolean>

  // 文档导出相关
  'export:word': (params: ExportParams) => Promise<boolean>
  'export:epub': (params: ExportParams) => Promise<boolean>
  'export:pdf': (params: ExportParams) => Promise<boolean>
}

// preload 暴露给渲染进程的统一 IPC 门面（window.novelWriter 的唯一类型）。
// 分组方法签名与上方 RendererToMainRequests 通道一一对应；旧的通用裸通道已移除。
export interface NovelWriterApi {
  project: {
    create: RendererToMainRequests['project:create']
    open: RendererToMainRequests['project:open']
  }
  file: {
    read: RendererToMainRequests['file:read']
    write: RendererToMainRequests['file:write']
    delete: RendererToMainRequests['file:delete']
    exists: RendererToMainRequests['file:exists']
  }
  chapter: {
    getAll: RendererToMainRequests['chapter:getAll']
    create: RendererToMainRequests['chapter:create']
    update: RendererToMainRequests['chapter:update']
    delete: RendererToMainRequests['chapter:delete']
    rename: RendererToMainRequests['chapter:rename']
    reorder: RendererToMainRequests['chapter:reorder']
    getById: RendererToMainRequests['chapter:getById']
  }
  character: {
    getAll: RendererToMainRequests['character:getAll']
    getById: RendererToMainRequests['character:getById']
    create: RendererToMainRequests['character:create']
    update: RendererToMainRequests['character:update']
    delete: RendererToMainRequests['character:delete']
  }
  setting: {
    getAll: RendererToMainRequests['setting:getAll']
    getById: RendererToMainRequests['setting:getById']
    create: RendererToMainRequests['setting:create']
    update: RendererToMainRequests['setting:update']
    delete: RendererToMainRequests['setting:delete']
  }
  dialog: {
    openDirectory: RendererToMainRequests['dialog:openDirectory']
    openFile: RendererToMainRequests['dialog:openFile']
    saveFile: RendererToMainRequests['dialog:saveFile']
  }
  theme: {
    set: RendererToMainRequests['theme:set']
  }
  stats: {
    get: RendererToMainRequests['stats:get']
    save: RendererToMainRequests['stats:save']
  }
  export: {
    word: RendererToMainRequests['export:word']
    epub: RendererToMainRequests['export:epub']
    pdf: RendererToMainRequests['export:pdf']
  }
  on: {
    projectCreated: (callback: (project: ProjectData) => void) => void
    projectOpened: (callback: (project: ProjectData) => void) => void
    fileSaved: (callback: (filePath: string) => void) => void
    statsUpdated: (callback: (stats: WritingStats) => void) => void
  }
  menu: {
    onEvent: (handler: (event: string, ...args: unknown[]) => void) => () => void
  }
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
  // v1 -> v2 迁移报告（未迁移的旧项目为 undefined/null）
  migration?: MigrationReport | null
}

// v1 -> v2 迁移报告（备份位置与告警明细）
export interface MigrationReport {
  backupPath: string
  warnings: string[]
}

// 项目配置
export interface ProjectConfig {
  wordCountGoal: number
  dailyGoal: number
  autoSave: boolean
  autoSaveInterval: number
}

// 最近项目（lastOpened 为 ISO 字符串，便于 zustand persist 序列化；展示时用 dayjs 格式化）
export interface RecentProject {
  id: string
  name: string
  path: string
  lastOpened: string
}

// 章节
export interface Chapter {
  id: string
  title: string
  content: string
  // v2 卷归属（v1 旧数据无此字段，迁移时补 null）
  volumeId?: string | null
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

// 写作统计（按项目持久化模型）
export interface DayStat {
  words: number
  minutes: number
}
export interface StatsData {
  dailyHistory: Record<string, DayStat>  // 'YYYY-MM-DD' -> DayStat
}

// 导出参数（word/pdf/epub 主进程生成用）
export interface ExportParams {
  chapters: { title: string; content: string }[]
  projectName: string
  options: { addFrontMatter?: boolean; addToc?: boolean }
  savePath: string
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
