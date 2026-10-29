// 「整理本章」触发链（M4b Task 4）：工具栏按钮 → 上下文装配 → organize 提示词 → ai:chat →
// 宽容解析 → 提案盖章 → proposal:save → 徽章刷新。渲染层组装裁定（brief）：复用既有
// getAll* 通道 + book:readAiData（T4 新只读通道），零新增聚合读通道。
//
// 生命周期纪律（对齐 useGraphData/useWritingStats 先例）：
// - mountedRef 防卸载后 setState；
// - organizingRef 并发门（裁定 8）：第二次点击在途期间直接 no-op——一书架一整理，
//   跨章重复由「该章已有 pending 提案」的按钮禁用面兜住（UI 防呆；引擎侧另有
//   PROPOSAL_DUPLICATE 权威闸门——Task 6 P2，双窗口各自在途也只会落一份）；
// - deps 走 argsRef 每渲染刷新：organize 是长流程，事件回调/await 之后必须读到最新闭包
//   （编辑器缓冲、projectPath），同 Workspace saveRef 惯用法。
//
// 纯逻辑（解析+盖章+校验）全部压在本模块外的 src/common/organizeResult.ts（单测覆盖）；
// 本 hook 只剩 I/O 编排——无 jsdom，交互面由 Task 6 CDP 冒烟兜底（静态走查见 task-4-report）。
//
// 错误面（裁定 9）：
// - ai 失败按 kind 路由中文 toast（文案表 services/aiErrorText 单一权威）；
// - 解析失败 → 固定文案 + console 只记原文长度（原文可能逐字引用正文，隐私红线绝不落日志）；
// - 提案校验不过 → 平文展示 validateProposal 错误串（本地纯函数错误，无前缀可归一）；
// - proposal:save 通道拒绝 → services/proposalErrors 中文归一（T6 结转，PROPOSAL_* 词表单源）；
// - 外层 catch 意外上抛 → organizeFailureText 归一：已冠「操作失败：」者原样作 toast，
//   不再叠「整理失败：」双前缀（结转微批 #2）；
// - changes 为空 → message.info 不算错（裁定 2：不落盘、无文件）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from 'antd'
import { useAI } from '../../../hooks/useAI'
import {
  useAiData,
  useChapter,
  useCharacter,
  useNarrative,
  useProposal,
  useSetting,
  useVolume,
  useAISettings
} from '../../../hooks/useIPC'
import { aiErrorToast } from '../../../services/aiErrorText'
import { proposalErrorText } from '../../../services/proposalErrors'
import { subscribeEntitiesChanged } from '../../../services/entityEvents'
import { withLedgerLoudError } from './ledgerFallback'
import { organizeFailureText } from './organizeFailureText'
import { assembleAiContext } from '@/common/ai-context'
import { budgetToMaxTokens, buildOrganizePrompt } from '@/common/organizePrompt'
import { buildProposalFromAi } from '@/common/organizeResult'
import { isUnsettled } from '@/common/proposal'
import type { Chapter, ProjectConfig } from '@/common/ipc'
import type { AiMessage, AiSettingsView } from '@/common/ai-types'
import type { ForeshadowEntry } from '@/common/schema'

/**
 * organize 输入预算（token，估算口径见 ai-context.estimateTokens）。
 * 24000 = 装配器分层红线下的整机档位：正文保底（80% cap）+ 涉事实体卡 + 前三章摘要 +
 * 卷梗概 + 大纲线按序填充；超出即分层丢弃/截断，绝不整本塞书（spec §7.4）。
 * 输出上限由 budgetToMaxTokens 从同一预算夹取（clamp 2048..16384）。
 */
const ORGANIZE_INPUT_BUDGET = 24000

/** organize 空闲上限（ms，裁定 6）：连续 180s 无任何流增量才判死——长整理（大章 + 多卡）留足余量。 */
const ORGANIZE_IDLE_TIMEOUT_MS = 180_000

/** 解析失败兜底文案（固定，绝不含原文片段）。 */
const PARSE_FAIL_TEXT = 'AI 输出无法解析为提案，请重试'

export interface OrganizeDeps {
  projectPath?: string
  /** 书名（进 ContextBook.meta.name，仅供上下文层展示，装配器目前只消费 synopsis） */
  projectName?: string
  /** 项目配置（填充 BookMeta.config 形状；装配器不消费，缺省用中性默认） */
  config?: ProjectConfig
  /**
   * 取整理章的「此刻」标题与正文：优先编辑器缓冲（用户所见即所整理，quote 逐字铁律
   * 要求出处与缓冲一致）；返回 null = 会话中没有这一章（调用方回落磁盘内容）。
   */
  getBufferChapter: (chapterId: string) => { title: string; body: string } | null
}

export interface OrganizeController {
  /** 在途标志（按钮 loading/禁用）。 */
  organizing: boolean
  /** 未消化提案数（status ≠ settled 的提案文件数——badge 计数）。 */
  pendingCount: number
  /** 已有未消化提案的章 id 集合（同章重复整理入口的禁用判据）。 */
  pendingChapterIds: Set<string>
  /** 跑一次本章整理（并发门内单次；所有失败只 toast，本函数不 reject）。 */
  organize: (chapterId: string) => Promise<void>
  /**
   * 取消在途整理（M4c-2 Task 6，裁定 4）：ai:cancel(requestId)——true 触发 abort →
   * toast「已取消整理」；false = 请求已自行收尾，正常完成路径照常赢（不另造状态机）。
   * 上下文装配窗口（chat 受理前，毫秒级）无 requestId 可取消，点击静默 no-op。
   */
  cancel: () => Promise<void>
  /** 重拉 proposal:getAll 更新徽章（挂载 / 成功落盘 / entityEvents 三处触发，裁定 7）。 */
  refreshPending: () => Promise<void>
}

const DEFAULT_CONFIG: ProjectConfig = {
  wordCountGoal: 0,
  dailyGoal: 0,
  autoSave: false,
  autoSaveInterval: 0
}

/** AiSettingsView → 模型显示名：复刻 chatService 的解析序（feature 覆盖 > 默认模型）。 */
function resolveModelLabel(view: AiSettingsView): string {
  const organizeModel = (view.models?.organize ?? '').trim()
  return organizeModel !== '' ? organizeModel : (view.defaultModel ?? '').trim()
}

/** 掩码视图的配置齐全判定（isConfigured 的 view 侧等价式：protocol ∧ baseUrl ∧ hasKey）。 */
function isConfiguredView(view: AiSettingsView): boolean {
  return Boolean(view.protocol) && Boolean(view.baseUrl) && view.hasKey
}

/** 提案列表 → 徽章形状：未消化计数 + 章 id 集合（谓词走 isUnsettled 单源——m4b 结转 d 项）。 */
function pendingShape(proposals: { chapterId: string; status: string }[]): {
  count: number
  chapters: Set<string>
} {
  const unsettled = proposals.filter((p) => isUnsettled(p))
  return { count: unsettled.length, chapters: new Set(unsettled.map((p) => p.chapterId)) }
}

export function useOrganize(deps: OrganizeDeps): OrganizeController {
  // T6 CDP 冒烟修复：静态 message.* 触发 antd dev 告警（console.error）——改走 App.useApp()
  // 上下文实例（本 hook 恒在 <App> 树内的 Workspace 中调用；与 Home/面板同款惯例）
  const { message } = App.useApp()
  const { chat, cancel: cancelAI } = useAI()
  const { getAllChapters } = useChapter()
  const { getAllVolumes } = useVolume()
  const { getAllCharacters } = useCharacter()
  const { getAllSettings } = useSetting()
  const { getForeshadowLedger } = useNarrative()
  const { getAllProposals, saveProposal } = useProposal()
  const { getAISettings } = useAISettings()
  const { readAiData } = useAiData()

  const [organizing, setOrganizing] = useState(false)
  const [pending, setPending] = useState<{ count: number; chapters: Set<string> }>({
    count: 0,
    chapters: new Set()
  })

  const organizingRef = useRef(false)
  // 在途 chat 的 requestId（取消按钮的唯一句柄）：runChat 受理后写入，终态/收尾即清空。
  // 刻意只存「最新一个」——并发门保证同时在途至多一个整理（裁定 8）。
  const activeRequestIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // deps 镜像 ref：长流程 await 之后读最新闭包（同 Workspace saveRef 惯用法）
  const argsRef = useRef(deps)
  argsRef.current = deps

  const refreshPending = useCallback(async (): Promise<void> => {
    const { projectPath } = argsRef.current
    if (!projectPath) return
    try {
      const list = await getAllProposals(projectPath)
      if (mountedRef.current) setPending(pendingShape(list))
    } catch (err) {
      // 徽章拉取失败不打扰用户（静默保旧值）：console 留痕即可，面板数据源同败在通道侧自有告警
      console.error('[useOrganize] 提案徽章刷新失败:', err)
    }
  }, [getAllProposals])

  // 挂载/换书即拉徽章 + 订阅实体事件（裁定 7：T5 采纳/驳回面板 notifyEntitiesChanged 后徽章自动回落；
  // organize 成功路径另行直接 refreshPending，不绕通知）
  const projectPath = deps.projectPath
  useEffect(() => {
    if (!projectPath) return
    void refreshPending()
  }, [projectPath, refreshPending])
  useEffect(() => {
    const unsub = subscribeEntitiesChanged(() => void refreshPending())
    return unsub
  }, [refreshPending])

  /** 发起一次 chat 并收全文；onError 已 toast，返回值只表达成/败（失败原因已面呈用户）。 */
  const runChat = useCallback(
    async (args: {
      projectPath: string
      messages: AiMessage[]
      maxTokens: number
    }): Promise<{ ok: true; text: string } | { ok: false }> => {
      let text = ''
      let terminal: 'done' | 'error' | null = null
      await new Promise<void>((resolve) => {
        void chat(
          {
            projectPath: args.projectPath,
            feature: 'organize',
            model: undefined, // 主进程按 settings.models.organize > defaultModel 解析（裁定 6）
            messages: args.messages,
            maxTokens: args.maxTokens,
            timeoutMs: ORGANIZE_IDLE_TIMEOUT_MS
          },
          {
            onChunk: (t) => {
              text += t
            },
            onDone: () => {
              terminal = 'done'
              activeRequestIdRef.current = null
              resolve()
            },
            onError: (kind, detail) => {
              terminal = 'error'
              activeRequestIdRef.current = null
              // 'cancelled' 只可能来自本页面的取消按钮（cancelOrganize 已 toast「已取消整理」），
              // 不二次报错；其余 kind 走 aiErrorText 单一权威文案表
              if (kind !== 'cancelled') message.error(aiErrorToast(kind, detail), 8)
              resolve()
            }
          }
        ).then((requestId) => {
          // chat() 在受理（或受理前失败）后才 resolve 出 id：已终态则不再存（陈旧 id 无取消语义）
          if (terminal === null) activeRequestIdRef.current = requestId
        })
      })
      return terminal === 'done' ? { ok: true, text } : { ok: false }
    },
    [chat, message]
  )

  /** 取消在途整理（裁定 4）：仅取消已受理的 AI 请求；abort 后的 'cancelled' 终态由 runChat 静默收敛。 */
  const cancelOrganize = useCallback(async (): Promise<void> => {
    const requestId = activeRequestIdRef.current
    if (!organizingRef.current || !requestId) return // 不在途 / 上下文装配窗口（毫秒级）尚无 requestId：无可取消，no-op
    try {
      const ok = await cancelAI(requestId)
      // false = 请求已自行收尾（成功/失败照常回报，正常完成路径赢）；true = 本次点击触发 abort
      if (ok && mountedRef.current) message.success('已取消整理')
    } catch (err) {
      console.error('[useOrganize] 取消请求失败:', err)
      if (mountedRef.current) message.error(`取消失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [cancelAI, message])

  const organize = useCallback(
    async (chapterId: string): Promise<void> => {
      if (organizingRef.current) return // 裁定 8：在途二次点击 no-op
      const { projectPath, projectName, config, getBufferChapter } = argsRef.current
      if (!projectPath) return
      organizingRef.current = true
      setOrganizing(true)
      try {
        // —— 1. 上下文原料（渲染层组装裁定：全部复用既有读通道） ——
        const view = await getAISettings()
        if (!isConfiguredView(view)) {
          message.error(aiErrorToast('not-configured'), 8)
          return
        }
        // 台账这一路（六路中唯一会抛穿）：坏台账 = fail-loud 中止整理，且文案经 narrativeErrorText
        // 中文归一后再上抛——整理花用户 token，绝不静默降级空台账（Task 7 收口裁定，与图谱侧
        // withLedgerFallback 的只读降级刻意不对称；见 ledgerFallback.ts 文件头）。
        const [chapters, volumes, characters, world, ledger, aiData] = await Promise.all([
          getAllChapters(projectPath),
          getAllVolumes(projectPath),
          getAllCharacters(projectPath),
          getAllSettings(projectPath),
          withLedgerLoudError(() => getForeshadowLedger(projectPath)),
          readAiData(projectPath)
        ])
        const disk = chapters.find((c: Chapter) => c.id === chapterId)
        if (!disk) {
          message.error('当前章节不存在或已被删除，无法整理')
          return
        }
        const buffered = getBufferChapter(chapterId)
        const chapterTitle = buffered?.title ?? disk.title
        const chapterBody = buffered?.body ?? disk.content

        // —— 2. 装配 + 提示词 ——
        const pendingForeshadows: ForeshadowEntry[] = ledger.entries.filter((e) => e.status === 'open')
        const assembled = assembleAiContext({
          book: {
            meta: {
              id: '',
              name: projectName ?? '',
              type: 'novel',
              formatVersion: 2,
              config: config ?? DEFAULT_CONFIG,
              synopsis: ''
            },
            volumes,
            // book.json 梗概经 book:readAiData 的 meta 投影进入大纲层（Task 6 P1）：
            // 装配器以「大纲注记」行渲染；空梗概 = 该文本段照旧缺席，卷列表层不受影响
            outlineNotes: aiData.meta.synopsis,
            chapters: chapters.map((c) => ({
              id: c.id,
              title: c.title,
              volumeId: c.volumeId ?? null,
              order: c.order
            }))
          },
          currentChapterId: chapterId,
          chapterBody,
          chapterSummaries: aiData.chapterSummaries,
          volumeSummaries: aiData.volumeSummaries,
          entityIndex: aiData.entityIndex,
          entityCards: { character: characters, world },
          budgetTokens: ORGANIZE_INPUT_BUDGET
        })
        const messages = buildOrganizePrompt({ assembled, chapterTitle, chapterId, pendingForeshadows })

        // —— 3. 调用（chunk 累加全文；失败已在 onError toast） ——
        const out = await runChat({
          projectPath,
          messages,
          maxTokens: budgetToMaxTokens(ORGANIZE_INPUT_BUDGET)
        })
        if (!out.ok) return

        // —— 4. 解析 + 盖章 + 校验（纯函数，单测覆盖） ——
        const built = buildProposalFromAi(out.text, chapterId, resolveModelLabel(view))
        if (built.kind === 'parse-failed') {
          // 裁定 9：日志只记长度，AI 原文可能逐字引用正文，绝不落 console
          console.error(`[useOrganize] ${PARSE_FAIL_TEXT}（输出长度 ${out.text.length}）`)
          message.error(PARSE_FAIL_TEXT)
          return
        }
        if (built.kind === 'empty') {
          message.info('AI 未发现需要记录的变更') // 裁定 2：无文件、无错误
          return
        }
        if (built.kind === 'invalid') {
          message.error(`提案校验未通过：${built.errors.join('; ')}`, 8)
          return
        }

        // —— 5. 落盘（主进程双保险再校验 + 章存在盖章 + 200 条上限） ——
        try {
          await saveProposal(projectPath, built.file)
        } catch (err) {
          // PROPOSAL_INVALID/TOO_LARGE/CHAPTER_MISSING/DUPLICATE…中文归一（词表单源），console 留原文
          const raw = err instanceof Error ? err.message : String(err)
          console.error('[useOrganize] 提案落盘失败:', raw)
          message.error(proposalErrorText(raw), 8)
          return
        }
        message.success(`整理提案已生成（${built.file.changes.length} 条变更）`)
        await refreshPending()
      } catch (err) {
        console.error('[useOrganize] 整理流程异常:', err)
        message.error(organizeFailureText(err instanceof Error ? err.message : String(err)), 8)
      } finally {
        organizingRef.current = false
        activeRequestIdRef.current = null // 取消句柄随批次收尾（任何路径不留陈旧 id）
        if (mountedRef.current) setOrganizing(false)
      }
    },
    // chat 刻意不入依赖：对话调用封装在 runChat（其依赖自带 chat），本回调只消费 runChat
    [getAllChapters, getAllVolumes, getAllCharacters, getAllSettings, getForeshadowLedger, readAiData, getAISettings, runChat, saveProposal, refreshPending, message]
  )

  return {
    organizing,
    pendingCount: pending.count,
    pendingChapterIds: pending.chapters,
    organize,
    cancel: cancelOrganize,
    refreshPending
  }
}
