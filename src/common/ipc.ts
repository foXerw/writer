// IPC通信类型定义

// 仅类型导入（双向 type-only 环：schema.ts 从这里取枚举类型，这里从 schema 取 CharacterV2——
// tsc/vite 编译期即擦除，无运行时循环依赖）。
import type {
  AiChatRequest,
  AiChunkEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiSettingsPatch,
  AiSettingsView,
  AiUsageSummary
} from './ai-types'
import type {
  CharacterV2,
  ChoiceNodeV2,
  ForeshadowEntry,
  ForeshadowLedger,
  PlotlineV2,
  WorldEntryV2
} from './schema'
import type { ProposalAdoptResult, ProposalFile } from './proposal'
import type { ReviewOpinion } from './reviewTypes'

// 主进程 -> 渲染进程 事件
export type MainToRendererEvents = {
  'project:created': (project: ProjectData) => void
  'project:opened': (project: ProjectData) => void
  'file:saved': (filePath: string) => void
  'stats:updated': (stats: WritingStats) => void
  'menu:event': (event: string, ...args: unknown[]) => void
  // Task 9：书目录外部变更（watcher 300ms debounce 合并后一次广播；本应用自写已在广播前按
  // ~1s 自写窗口剔除——修订轮2 I1，取代裁定 5「接受回声噪音」，常态只达外部改动；越窗漏出的
  // 自写仍由渲染层内容比对兜底）
  'book:changed': (event: BookChangedEvent) => void
  // Task 4：AI 流式对话事件（event.sender 定向广播，非全局；按 requestId 认领）。
  // ai:chat 的受理前失败（not-configured/busy 等）不走 ai:error，而是同步 reject——
  // 事件按 requestId 分发，重复请求的失败发事件会误杀在途原请求，这是有意的分界。
  'ai:chunk': (event: AiChunkEvent) => void
  'ai:done': (event: AiDoneEvent) => void
  'ai:error': (event: AiErrorEvent) => void
}

// book:changed 事件载荷（Task 9）：paths = 相对书根、正斜杠、升序去重的变更路径
// （如 `chapters/<id>.md`、`world/location/<id>.yaml`；.tmp- 残留与 book.json 等非实体域路径已在主进程过滤）
export interface BookChangedEvent {
  paths: string[]
}

// `.ai/` 派生数据只读快照（M4b Task 4 book:readAiData 载荷；仓库层 electron/main/bookStore/aiData.ts）。
// 键序语义：chapterSummaries 章 id → 摘要文本、volumeSummaries 卷 id → 梗概文本、
// entityIndex 实体 id → 出场章 id 列表、meta 书目注记投影（book.json 的 name/synopsis，Task 6 P1：
// organize 上下文大纲层原料）。缺文件/坏文件在源侧已按「空/跳过」容错，渲染层拿到恒为形状完好的对象。
export interface AiDataSnapshot {
  chapterSummaries: Record<string, string>
  volumeSummaries: Record<string, string>
  entityIndex: Record<string, string[]>
  meta: { name: string; synopsis: string }
}

// 渲染进程 -> 主进程 请求
export type RendererToMainRequests = {
  // 项目相关
  'project:create': (params: { name: string; path: string; type: ProjectType }) => Promise<ProjectData>
  'project:open': (path: string) => Promise<ProjectData>

  // 书内 AI 派生数据（M4b Task 4；纯读零校验，organize 上下文装配原料）
  'book:readAiData': (params: { projectPath: string }) => Promise<AiDataSnapshot>

  // 文件相关
  'file:read': (path: string) => Promise<string>
  'file:write': (params: { path: string; content: string }) => Promise<boolean>
  'file:delete': (path: string) => Promise<boolean>
  'file:exists': (path: string) => Promise<boolean>

  // 章节相关
  'chapter:getAll': (projectPath: string) => Promise<Chapter[]>
  'chapter:create': (params: {
    projectPath: string
    title: string
    // Task 5：新建章落在当前卷（未传/null = 未分卷）
    volumeId?: string | null
  }) => Promise<Chapter>
  // Task 5 评审整改：本通道只写编辑字段（title/content/status）；整 Chapter 里的
  // volumeId 会被 handler 忽略——归属唯一写通道 = chapter:moveToVolume
  'chapter:update': (params: { projectPath: string; chapter: Chapter }) => Promise<Chapter>
  'chapter:delete': (params: { projectPath: string; chapterId: string }) => Promise<boolean>
  'chapter:rename': (params: { projectPath: string; chapterId: string; newTitle: string }) => Promise<Chapter>
  'chapter:reorder': (params: { projectPath: string; fromId: string; toId: string }) => Promise<boolean>
  // bypassCache（Task 9 修订 ①）：true = 跳过仓库缓存直读磁盘真相——外部改动冲突判定的专用输入
  'chapter:getById': (params: {
    projectPath: string
    chapterId: string
    bypassCache?: boolean
  }) => Promise<Chapter | null>
  // 整章重建（Task 9 修订轮2 I2）：不读既有文件的整体替换——「保留我的」对已被外删/损坏章的救援；
  // meta 重置默认（volumeId=null/status=draft/order=max+1），content 逐字节写入
  'chapter:rebuild': (params: {
    projectPath: string
    id: string
    title: string
    content: string
  }) => Promise<Chapter>
  // 改卷归属（Task 5）：volumeId = null 或未传 → 未分卷；缺省绝不视同「不改归属」
  'chapter:moveToVolume': (params: {
    projectPath: string
    chapterId: string
    volumeId: string | null
  }) => Promise<Chapter>

  // 卷相关（Task 5 一等公民：volumes/<id>.yaml = VolumeDoc{id,title,order}）
  'volume:getAll': (projectPath: string) => Promise<Volume[]>
  'volume:create': (params: { projectPath: string; title: string }) => Promise<Volume>
  'volume:rename': (params: {
    projectPath: string
    volumeId: string
    newTitle: string
  }) => Promise<Volume>
  'volume:delete': (params: { projectPath: string; volumeId: string }) => Promise<boolean>
  'volume:reorder': (params: {
    projectPath: string
    fromId: string
    toId: string
  }) => Promise<boolean>

  // 角色相关（Task 6：v2 人物卡 CharacterV2——关系边按 id、时间戳 ISO 字符串；
  // 通道名不变，v1 Character 接口随仓库重写退役）
  'character:getAll': (projectPath: string) => Promise<CharacterV2[]>
  'character:getById': (params: { projectPath: string; characterId: string }) => Promise<CharacterV2 | null>
  'character:create': (params: { projectPath: string; character: Partial<CharacterV2> }) => Promise<CharacterV2>
  'character:update': (params: { projectPath: string; character: CharacterV2 }) => Promise<CharacterV2>
  'character:delete': (params: { projectPath: string; characterId: string }) => Promise<boolean>

  // 世界观设定相关（Task 7：v2 词条 WorldEntryV2——world/<类别>/<全id>.yaml，时间戳 ISO 字符串；
  // 通道名不变，v1 Setting 接口随仓库重写退役）
  'setting:getAll': (projectPath: string) => Promise<WorldEntryV2[]>
  'setting:getById': (params: { projectPath: string; settingId: string }) => Promise<WorldEntryV2 | null>
  'setting:create': (params: { projectPath: string; setting: Partial<WorldEntryV2> }) => Promise<WorldEntryV2>
  'setting:update': (params: { projectPath: string; setting: WorldEntryV2 }) => Promise<WorldEntryV2>
  'setting:delete': (params: { projectPath: string; settingId: string }) => Promise<boolean>

  // 剧情线相关（Task 8：plotlines/<id>.yaml = PlotlineV2——stages[] 对章/实体 id 做「新引用」检查；
  // 纯数据层，录入 UI 按 M1 裁定随 M4）
  'plotline:getAll': (projectPath: string) => Promise<PlotlineV2[]>
  'plotline:create': (params: { projectPath: string; plotline: Partial<PlotlineV2> }) => Promise<PlotlineV2>
  'plotline:update': (params: { projectPath: string; plotline: PlotlineV2 }) => Promise<PlotlineV2>
  'plotline:delete': (params: { projectPath: string; plotlineId: string }) => Promise<boolean>

  // 关键选项相关（Task 8：choices/<id>.yaml = ChoiceNodeV2——chapterId 单值引用检查，改到幻影才拒）
  'choice:getAll': (projectPath: string) => Promise<ChoiceNodeV2[]>
  'choice:create': (params: { projectPath: string; choice: Partial<ChoiceNodeV2> }) => Promise<ChoiceNodeV2>
  'choice:update': (params: { projectPath: string; choice: ChoiceNodeV2 }) => Promise<ChoiceNodeV2>
  'choice:delete': (params: { projectPath: string; choiceId: string }) => Promise<boolean>

  // 伏笔台账相关（Task 8：foreshadow.yaml 单文件台账；转移函数返回整本新台账，渲染层直接替换。
  // foreshadow:reopen 为 Task 8 裁定新增——brief 清单未列，但 resolved/abandoned→open 撤回边别无入口）
  'foreshadow:get': (projectPath: string) => Promise<ForeshadowLedger>
  'foreshadow:upsert': (params: { projectPath: string; entry: ForeshadowEntry }) => Promise<ForeshadowLedger>
  'foreshadow:resolve': (params: {
    projectPath: string
    foreshadowId: string
    resolvedChapterId: string
  }) => Promise<ForeshadowLedger>
  'foreshadow:abandon': (params: { projectPath: string; foreshadowId: string }) => Promise<ForeshadowLedger>
  'foreshadow:reopen': (params: { projectPath: string; foreshadowId: string }) => Promise<ForeshadowLedger>

  // AI 整理提案相关（M4b Task 3：.ai/proposals/<id>.yaml = ProposalFile。新通道组纪律：
  // 参数一律 {projectPath, …} 对象形状。错误是 PROPOSAL_*: 前缀平文消息（非 AI 路径的 [kind] 词表），
  // 渲染层原样展示；逐条采纳拒绝在 adopt 结果 refused[] 里按 key 返回，不是通道错误。
  // save 是双保险（渲染层已 validateProposal 一次）+ 盖章（出处章必须现存）；
  // M4c-1 键域：adopt/reject 以 changeKey 键集说话（cid ?? 位置回退键，单源 proposal.ts），
  // confirmedOverwrite = UI 已显式确认「覆盖人写内容」的条目键（R1 origin 机制）。
  'proposal:getAll': (params: { projectPath: string }) => Promise<ProposalFile[]>
  'proposal:get': (params: { projectPath: string; id: string }) => Promise<ProposalFile | null>
  'proposal:save': (params: { projectPath: string; file: ProposalFile }) => Promise<ProposalFile>
  'proposal:adopt': (params: {
    projectPath: string
    proposalId: string
    changeKeys: string[]
    confirmedOverwrite: string[]
  }) => Promise<ProposalAdoptResult>
  'proposal:reject': (params: {
    projectPath: string
    proposalId: string
    changeKeys: string[]
  }) => Promise<void>

  // 章节审阅相关（M6 T1：.ai/reviews/<chapterId>.json = ReviewOpinion[] 单文件 JSON 账本。
  // 新通道组纪律同 proposal：参数一律 {projectPath, …} 对象形状；错误是 REVIEW_*: 前缀平文
  // （REVIEW_INVALID/REVIEW_MISSING/REVIEW_NOT_OPEN/REVIEW_CHAPTER_MISSING/BAD_REVIEW_CHAPTER_ID，
  // 定义见 electron/main/bookStore/reviews.ts），渲染层在审阅对话框内原样展示。
  // saveRun 按章替换合并（矩阵语义在存储层）并返回合并后全集；dismiss/markConverted
  // 是状态迁移唯一写入口（幂等驳回 / 转化指针唯一），均返回更新后全集。
  'review:get': (params: { projectPath: string; chapterId?: string }) => Promise<ReviewOpinion[]>
  'review:saveRun': (params: {
    projectPath: string
    chapterId: string
    opinions: ReviewOpinion[]
    model: string
  }) => Promise<ReviewOpinion[]>
  'review:dismiss': (params: {
    projectPath: string
    chapterId: string
    opinionId: string
  }) => Promise<ReviewOpinion[]>
  'review:markConverted': (params: {
    projectPath: string
    chapterId: string
    opinionId: string
    proposalId: string
  }) => Promise<ReviewOpinion[]>

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

  // AI 相关（M4a Task 2：设置保险库三通道。getSettings 返回值永远是掩码视图 AiSettingsView——
  // 明文 apiKey 永不跨 IPC；chat/cancel/getUsage 通道随 Task 4 加入，此处不预留死门面）
  'ai:getSettings': () => Promise<AiSettingsView>
  'ai:setSettings': (patch: AiSettingsPatch) => Promise<AiSettingsView>
  // testConnection（M4a Task 6 真实现）：成功 resolve {ok:true, sample}（连通性证据，不含密钥）；
  // 失败 reject，message 带 `[kind] ` 前缀（not-configured/auth/network/timeout/provider/cancelled），
  // 由渲染层 parseKindTaggedError 解包分类——kind 属性跨不过 ipcMain.handle 序列化，前缀即协议。
  'ai:testConnection': () => Promise<{ ok: true; sample: string }>
  // AI 对话（M4a Task 4）：chat 是 fire-and-forget 语义——resolve 的 {accepted:true} 只表示
  // 「已受理进入在途」，正文/结果/失败一律经 ai:chunk|ai:done|ai:error 事件按 requestId 回来；
  // 受理前失败（not-configured/busy/未配置模型/形状非法）则 promise 直接 reject，
  // message 形如 `[busy] 请求 … 正在处理中`（kind 编进前缀，useAI 解包成 AiErrorEvent.kind）。
  'ai:chat': (request: AiChatRequest) => Promise<{ accepted: true }>
  'ai:cancel': (requestId: string) => Promise<boolean>
  'ai:getUsage': (projectPath: string) => Promise<AiUsageSummary>
}

// preload 暴露给渲染进程的统一 IPC 门面（window.novelWriter 的唯一类型）。
// 分组方法签名与上方 RendererToMainRequests 通道一一对应；旧的通用裸通道已移除。
export interface NovelWriterApi {
  project: {
    create: RendererToMainRequests['project:create']
    open: RendererToMainRequests['project:open']
  }
  // 书内 AI 派生数据（M4b Task 4）
  book: {
    readAiData: RendererToMainRequests['book:readAiData']
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
    moveToVolume: RendererToMainRequests['chapter:moveToVolume']
    rebuild: RendererToMainRequests['chapter:rebuild']
  }
  volume: {
    getAll: RendererToMainRequests['volume:getAll']
    create: RendererToMainRequests['volume:create']
    rename: RendererToMainRequests['volume:rename']
    delete: RendererToMainRequests['volume:delete']
    reorder: RendererToMainRequests['volume:reorder']
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
  plotline: {
    getAll: RendererToMainRequests['plotline:getAll']
    create: RendererToMainRequests['plotline:create']
    update: RendererToMainRequests['plotline:update']
    delete: RendererToMainRequests['plotline:delete']
  }
  choice: {
    getAll: RendererToMainRequests['choice:getAll']
    create: RendererToMainRequests['choice:create']
    update: RendererToMainRequests['choice:update']
    delete: RendererToMainRequests['choice:delete']
  }
  foreshadow: {
    get: RendererToMainRequests['foreshadow:get']
    upsert: RendererToMainRequests['foreshadow:upsert']
    resolve: RendererToMainRequests['foreshadow:resolve']
    abandon: RendererToMainRequests['foreshadow:abandon']
    reopen: RendererToMainRequests['foreshadow:reopen']
  }
  // AI 整理提案（M4b Task 3；契约见 RendererToMainRequests 上方注释）
  proposal: {
    getAll: RendererToMainRequests['proposal:getAll']
    get: RendererToMainRequests['proposal:get']
    save: RendererToMainRequests['proposal:save']
    adopt: RendererToMainRequests['proposal:adopt']
    reject: RendererToMainRequests['proposal:reject']
  }
  // 章节审阅（M6 T1；契约见 RendererToMainRequests 上方注释）
  review: {
    get: RendererToMainRequests['review:get']
    saveRun: RendererToMainRequests['review:saveRun']
    dismiss: RendererToMainRequests['review:dismiss']
    markConverted: RendererToMainRequests['review:markConverted']
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
  // AI 设置（M4a Task 2；对话方法随 Task 4 在此组扩展）
  ai: {
    getSettings: RendererToMainRequests['ai:getSettings']
    setSettings: RendererToMainRequests['ai:setSettings']
    testConnection: RendererToMainRequests['ai:testConnection']
    // Task 4：对话三通道（契约见 RendererToMainRequests 上方注释）
    chat: RendererToMainRequests['ai:chat']
    cancel: RendererToMainRequests['ai:cancel']
    getUsage: RendererToMainRequests['ai:getUsage']
  }
  on: {
    // 注：以下四条为 M1 遗留死通道（主进程从未广播），M4 清理待办——保留不动（Task 9 裁定 6）
    projectCreated: (callback: (project: ProjectData) => void) => void
    projectOpened: (callback: (project: ProjectData) => void) => void
    fileSaved: (callback: (filePath: string) => void) => void
    statsUpdated: (callback: (stats: WritingStats) => void) => void
    // Task 9：订阅 book:changed，返回精确反订阅函数（removeListener 只摘自己加的监听——镜像 menu.onEvent 先例）
    bookChanged: (handler: (event: BookChangedEvent) => void) => () => void
    // Task 4：AI 流式事件三通道——与 bookChanged 同一纪律（typed handler、返回精确反订阅，
    // removeListener 摘本次包装函数，绝不用 removeAllListeners 误伤其他订阅者）
    aiChunk: (handler: (event: AiChunkEvent) => void) => () => void
    aiDone: (handler: (event: AiDoneEvent) => void) => () => void
    aiError: (handler: (event: AiErrorEvent) => void) => () => void
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

// 卷（v2 一等公民实体；与 common/schema.ts 的 VolumeDoc 同形——依赖方向 schema→ipc 保持不变，
// 此处独立声明供渲染层/preload 消费，卷仓库返回 VolumeDoc 结构即兼容）
export interface Volume {
  id: string
  title: string
  order: number
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

// 角色标签（v2 CharacterV2.tags 沿用 v1 结构——其 id 历史上非 UUID，schema.ts 校验器有意豁免）
export interface CharacterTag {
  id: string
  name: string
  color?: string
}

// v1 Character / CharacterRelationship / CharacterCreateParams 已随 Task 6 人物卡 v2 仓库重写退役：
// 通道载荷类型统一为 schema.ts 的 CharacterV2（关系边 EntityLink 按 id 引用）。

// 世界观设定分类
export type SettingCategory = 'location' | 'history' | 'magic' | 'culture' | 'other'

// v1 Setting 已随 Task 7 世界观词条 v2 仓库重写退役：
// 通道载荷类型统一为 schema.ts 的 WorldEntryV2（parentId 世界层级、links 按 id 引用、时间戳 ISO 字符串）。
