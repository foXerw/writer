import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  MainToRendererEvents,
  RendererToMainRequests,
  ProjectData,
  Chapter,
  Character,
  Setting,
  RecentProject,
  WritingStats,
  ProjectType
} from '../../src/common/ipc'

// 渲染进程 -> 主进程 请求
const projectAPI: RendererToMainRequests = {
  'project:create': (params) => ipcRenderer.invoke('project:create', params),
  'project:open': (path) => ipcRenderer.invoke('project:open', path),
  'project:getRecent': () => ipcRenderer.invoke('project:getRecent'),

  'file:read': (path) => ipcRenderer.invoke('file:read', path),
  'file:write': (params) => ipcRenderer.invoke('file:write', params),
  'file:delete': (path) => ipcRenderer.invoke('file:delete', path),
  'file:exists': (path) => ipcRenderer.invoke('file:exists', path),

  'chapter:getAll': (projectPath) => ipcRenderer.invoke('chapter:getAll', projectPath),
  'chapter:create': (params) => ipcRenderer.invoke('chapter:create', params),
  'chapter:update': (params) => ipcRenderer.invoke('chapter:update', params),
  'chapter:delete': (params) => ipcRenderer.invoke('chapter:delete', params),
  'chapter:rename': (params) => ipcRenderer.invoke('chapter:rename', params),
  'chapter:reorder': (params) => ipcRenderer.invoke('chapter:reorder', params),
  'chapter:getById': (params) => ipcRenderer.invoke('chapter:getById', params),

  'character:getAll': (projectPath) => ipcRenderer.invoke('character:getAll', projectPath),
  'character:getById': (params) => ipcRenderer.invoke('character:getById', params),
  'character:create': (params) => ipcRenderer.invoke('character:create', params),
  'character:update': (params) => ipcRenderer.invoke('character:update', params),
  'character:delete': (params) => ipcRenderer.invoke('character:delete', params),

  'setting:getAll': (projectPath) => ipcRenderer.invoke('setting:getAll', projectPath),
  'setting:getById': (params) => ipcRenderer.invoke('setting:getById', params),
  'setting:create': (params) => ipcRenderer.invoke('setting:create', params),
  'setting:update': (params) => ipcRenderer.invoke('setting:update', params),
  'setting:delete': (params) => ipcRenderer.invoke('setting:delete', params),

  'dialog:openDirectory': () => ipcRenderer.invoke('dialog:openDirectory'),
  'dialog:openFile': (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  'dialog:saveFile': (defaultPath) => ipcRenderer.invoke('dialog:saveFile', defaultPath)
}

// 主进程 -> 渲染进程 监听
const rendererListeners: MainToRendererEvents = {
  'project:created': (callback) => ipcRenderer.on('project:created', (_, data) => callback(data)),
  'project:opened': (callback) => ipcRenderer.on('project:opened', (_, data) => callback(data)),
  'file:saved': (callback) => ipcRenderer.on('file:saved', (_, path) => callback(path)),
  'stats:updated': (callback) => ipcRenderer.on('stats:updated', (_, stats) => callback(stats))
}

contextBridge.exposeInMainWorld('novelWriter', {
  // 项目相关
  project: {
    create: projectAPI['project:create'],
    open: projectAPI['project:open'],
    getRecent: projectAPI['project:getRecent']
  },

  // 文件相关
  file: {
    read: projectAPI['file:read'],
    write: projectAPI['file:write'],
    delete: projectAPI['file:delete'],
    exists: projectAPI['file:exists']
  },

  // 章节相关
  chapter: {
    getAll: projectAPI['chapter:getAll'],
    create: projectAPI['chapter:create'],
    update: projectAPI['chapter:update'],
    delete: projectAPI['chapter:delete'],
    rename: projectAPI['chapter:rename'],
    reorder: projectAPI['chapter:reorder'],
    getById: projectAPI['chapter:getById']
  },

  // 角色相关
  character: {
    getAll: projectAPI['character:getAll'],
    getById: projectAPI['character:getById'],
    create: projectAPI['character:create'],
    update: projectAPI['character:update'],
    delete: projectAPI['character:delete']
  },

  // 设定相关
  setting: {
    getAll: projectAPI['setting:getAll'],
    getById: projectAPI['setting:getById'],
    create: projectAPI['setting:create'],
    update: projectAPI['setting:update'],
    delete: projectAPI['setting:delete']
  },

  // 对话框
  dialog: {
    openDirectory: projectAPI['dialog:openDirectory'],
    openFile: projectAPI['dialog:openFile'],
    saveFile: projectAPI['dialog:saveFile']
  },

  // 监听器
  on: {
    projectCreated: rendererListeners['project:created'],
    projectOpened: rendererListeners['project:opened'],
    fileSaved: rendererListeners['file:saved'],
    statsUpdated: rendererListeners['stats:updated']
  },

  // 菜单事件
  menu: {
    onEvent: (handler: (event: string, ...args: unknown[]) => void) => {
      const listener = (_e: IpcRendererEvent, event: string, ...args: unknown[]) => handler(event, ...args)
      ipcRenderer.on('menu:event', listener)
      return () => {
        ipcRenderer.removeListener('menu:event', listener)
      }
    }
  }
})

// 新版 electronAPI 风格的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 通用 invoke/send/on/off
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => listener(...args))
  },
  off: (channel: string) => ipcRenderer.removeAllListeners(channel)
})

// 类型导出
export type NovelWriterAPI = {
  project: {
    create: (params: { name: string; path: string; type: ProjectType }) => Promise<ProjectData>
    open: (path: string) => Promise<ProjectData>
    getRecent: () => Promise<RecentProject[]>
  }
  file: {
    read: (path: string) => Promise<string>
    write: (params: { path: string; content: string }) => Promise<boolean>
    delete: (path: string) => Promise<boolean>
    exists: (path: string) => Promise<boolean>
  }
  chapter: {
    getAll: (projectPath: string) => Promise<Chapter[]>
    create: (params: { projectPath: string; title: string }) => Promise<Chapter>
    update: (params: { projectPath: string; chapter: Chapter }) => Promise<Chapter>
    delete: (params: { projectPath: string; chapterId: string }) => Promise<boolean>
    rename: (params: { projectPath: string; chapterId: string; newTitle: string }) => Promise<Chapter>
    reorder: (params: { projectPath: string; fromId: string; toId: string }) => Promise<boolean>
    getById: (params: { projectPath: string; chapterId: string }) => Promise<Chapter | null>
  }
  character: {
    getAll: (projectPath: string) => Promise<Character[]>
    getById: (params: { projectPath: string; characterId: string }) => Promise<Character | null>
    create: (params: { projectPath: string; character: Partial<Character> }) => Promise<Character>
    update: (params: { projectPath: string; character: Character }) => Promise<Character>
    delete: (params: { projectPath: string; characterId: string }) => Promise<boolean>
  }
  setting: {
    getAll: (projectPath: string) => Promise<Setting[]>
    getById: (params: { projectPath: string; settingId: string }) => Promise<Setting | null>
    create: (params: { projectPath: string; setting: Partial<Setting> }) => Promise<Setting>
    update: (params: { projectPath: string; setting: Setting }) => Promise<Setting>
    delete: (params: { projectPath: string; settingId: string }) => Promise<boolean>
  }
  dialog: {
    openDirectory: () => Promise<string | null>
    openFile: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>
    saveFile: (defaultPath: string) => Promise<string | null>
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

declare global {
  interface Window {
    novelWriter: {
      project: {
        create: (params: { name: string; path: string; type: ProjectType }) => Promise<ProjectData>
        open: (path: string) => Promise<ProjectData>
        getRecent: () => Promise<RecentProject[]>
      }
      file: {
        read: (path: string) => Promise<string>
        write: (params: { path: string; content: string }) => Promise<boolean>
        delete: (path: string) => Promise<boolean>
        exists: (path: string) => Promise<boolean>
      }
      chapter: {
        getAll: (projectPath: string) => Promise<Chapter[]>
        create: (params: { projectPath: string; title: string }) => Promise<Chapter>
        update: (params: { projectPath: string; chapter: Chapter }) => Promise<Chapter>
        delete: (params: { projectPath: string; chapterId: string }) => Promise<boolean>
        rename: (params: { projectPath: string; chapterId: string; newTitle: string }) => Promise<Chapter>
        reorder: (params: { projectPath: string; fromId: string; toId: string }) => Promise<boolean>
        getById: (params: { projectPath: string; chapterId: string }) => Promise<Chapter | null>
      }
      character: {
        getAll: (projectPath: string) => Promise<Character[]>
        getById: (params: { projectPath: string; characterId: string }) => Promise<Character | null>
        create: (params: { projectPath: string; character: Partial<Character> }) => Promise<Character>
        update: (params: { projectPath: string; character: Character }) => Promise<Character>
        delete: (params: { projectPath: string; characterId: string }) => Promise<boolean>
      }
      setting: {
        getAll: (projectPath: string) => Promise<Setting[]>
        getById: (params: { projectPath: string; settingId: string }) => Promise<Setting | null>
        create: (params: { projectPath: string; setting: Partial<Setting> }) => Promise<Setting>
        update: (params: { projectPath: string; setting: Setting }) => Promise<Setting>
        delete: (params: { projectPath: string; settingId: string }) => Promise<boolean>
      }
      dialog: {
        openDirectory: () => Promise<string | null>
        openFile: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>
        saveFile: (defaultPath: string) => Promise<string | null>
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
  }
}
