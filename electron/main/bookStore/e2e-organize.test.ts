// M4b Task 6 端到端离线链路证明（Review Focus 1）：真 tmp v2 书 + 假 http.fetch，
// 把「整理本章」人机闭环在 node 测试环境全链走通一遍——
//   seed 书（章/角色/世界设定/book.json 注记）
//   → readAiData（含 P1 meta 投影）→ assembleAiContext → buildOrganizePrompt
//   → chatService.startChat(feature organize，模型经 settings.models.organize 解析)
//   → 假 SSE 流（openai 协议帧，逐片段吐提案 JSON）→ ai:chunk 累加 → ai:done
//   → extractJsonLoose + buildProposalFromAi（src/common 纯函数，盖章+校验）
//   → proposal:save handler（真 IPC 层：双保险校验 + 盖章 + PROPOSAL_DUPLICATE 闸门）
//   → adoptChanges（引擎直驱，confirmed=[]——本剧本无 overwritesHuman 条目）
//   → 断言四路落盘：characters 新卡（aiTouched 播种）/ .ai/summaries 摘要 /
//     .ai/index.json 合并 / 提案 settled；最后 readAiData 复读证明闭环回流。
// mock 面刻意最小：electron 只替 ipcMain.handle 捕获表 + app.getPath('userData')
// （settings 落假 ai-settings.json，走真实 loadSettings 解析链——镜像 proposal.test.ts 套路）；
// http.fetch 按 providers.test.ts 的注入接缝纪律 vi.spyOn（全目录唯一 fetch 出口）。
// 真 provider（openai.ts）、真 chatService、真仓库、真提案存储——除网络之外零替身。
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkTmpBook } from '../../../tests/tmp'
import { http } from '../ai/providers/http'
import type { ChatEventSender } from '../ai/chatService'
import { startChat } from '../ai/chatService'
import type { AiSettings } from '../../../src/common/ai-types'
import { assembleAiContext } from '../../../src/common/ai-context'
import { budgetToMaxTokens, buildOrganizePrompt } from '../../../src/common/organizePrompt'
import { buildProposalFromAi } from '../../../src/common/organizeResult'
import type { ProposalAdoptResult, ProposalFile } from '../../../src/common/proposal'
import { proposalPath } from '../../../src/common/proposal'
import type { AiMessage } from '../../../src/common/ai-types'
import { adoptChanges } from './adopt'
import { getProposal } from './proposals'
import { readAiData } from './aiData'
import { createChapter, listChapters } from './chapters'
import { createCharacter, listCharacters } from './characters'
import { createWorldEntry, listWorldEntries } from './world'
import { listVolumes } from './volumes'
import { readLedger } from './narrative'
import { chapterSummaryFile } from './paths'
import { readYamlFile } from './docStore'

// —— electron 替身：handler 捕获表 + userData 目录持有器（工厂只引用 hoisted，同 proposal.test.ts 纪律）
const holder = vi.hoisted(() => ({ userData: '' }))
const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
)
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => Promise<unknown>
    ): void => {
      handlers.set(channel, listener)
    }
  },
  app: {
    getPath: (_name: string): string => holder.userData
  }
}))

import { registerProposalHandlers } from '../ipc/modules/proposal'

const SYNOPSIS = '拾荒少年在星环带捡到一台还在呼吸的老引擎。'

function getHandler(channel: string) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn
}

/** 假流用的剧本常量在测试体内现取（seed 后才知道 id），见 runOrganizeChain。 */
interface Emitted {
  channel: string
  payload: Record<string, unknown>
}

/** 收 ai:chunk/ai:done/ai:error 的替身窗口（chatService 测试同款结构）。 */
function makeSender(): { events: Emitted[]; sender: ChatEventSender; terminal: Promise<void> } {
  const events: Emitted[] = []
  let settle: () => void = () => {}
  const terminal = new Promise<void>((res) => {
    settle = res
  })
  const sender: ChatEventSender = {
    send: (channel, payload) => {
      events.push({ channel, payload: payload as Record<string, unknown> })
      if (channel === 'ai:done' || channel === 'ai:error') settle()
    },
    isDestroyed: () => false
  }
  return { events, sender, terminal }
}

/** SSE 文本按固定字节切块 → 真 Response（跨帧边界，镜像 providers.test.ts 的 sseResponse）。 */
function sseResponse(sseText: string, chunkSize = 17): Response {
  const bytes = new TextEncoder().encode(sseText)
  let offset = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize))
      offset += chunkSize
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** openai 协议帧：把提案全文切成 n 段增量 + usage 帧 + [DONE]。 */
function organizeSse(fullText: string): string {
  const pieces: string[] = []
  for (let i = 0; i < fullText.length; i += 37) pieces.push(fullText.slice(i, i + 37))
  const frames = pieces.map(
    (p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`
  )
  frames.push(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 120, completion_tokens: 64 } })}\n\n`)
  frames.push('data: [DONE]\n\n')
  return frames.join('')
}

function writeAiSettings(over: Partial<AiSettings> = {}): void {
  holder.userData = mkdtempSync(join(tmpdir(), 'perfect-novel-e2e-userdata-'))
  const settings: AiSettings = {
    protocol: 'openai',
    baseUrl: 'https://e2e.invalid.test',
    apiKey: 'sk-e2e-offline-key',
    defaultModel: 'fallback-model',
    models: { organize: 'e2e-organize-model' }, // feature 覆盖 > 默认：解析链的真实证明
    ...over
  }
  writeFileSync(join(holder.userData, 'ai-settings.json'), JSON.stringify(settings), 'utf8')
}

beforeAll(() => {
  registerProposalHandlers()
})

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('e2e：整理本章全链（假 fetch → 提案落盘 → 采纳四路 → settled）', () => {
  it('chatService+proposal:save+adoptChanges 一条龙：3 变更（create 角色 / update 摘要 / update 索引）全部真实落盘', async () => {
    // —— 0. 真 v2 书 seed ——
    const p = mkTmpBook()
    writeFileSync(
      join(p, 'book.json'),
      JSON.stringify({
        id: '11111111-1111-4111-8111-111111111111',
        name: '星海拾荒者',
        type: 'novel',
        formatVersion: 2,
        config: { wordCountGoal: 0, dailyGoal: 0, autoSave: false, autoSaveInterval: 0 },
        synopsis: SYNOPSIS
      }),
      'utf8'
    )
    const ch = createChapter(p, '第一章 星环带')
    const oldCat = createCharacter(p, { name: '老周', gender: 'male', role: 'supporting' }, {
      appearance: '灰袍老头',
      personality: '毒舌',
      background: '环带老居民'
    })
    createWorldEntry(p, { title: '星环带', category: 'other', content: '碎石环绕的旧采掘带' })
    writeAiSettings()

    // —— 1. 剧本：AI 返回 3 条变更（source 只有 quote——契约形状） ——
    const proposalJson = JSON.stringify({
      changes: [
        {
          op: 'create',
          entity: 'character',
          after: {
            name: '新配角',
            gender: 'other',
            age: 40,
            role: 'minor',
            appearance: '裹在防辐射斗篷里',
            personality: '沉默寡言',
            background: '',
            relationships: [],
            arc: [],
            tags: [],
            links: []
          },
          source: { quote: '斗篷下伸出一只戴着三层手套的手。' }
        },
        {
          op: 'update',
          entity: 'summary',
          targetId: ch.id,
          after: { text: '老周引路，拾荒队初入星环带，遭遇不明斗篷人。' },
          source: { quote: '老周回头瞪了他一眼，示意噤声。' }
        },
        {
          op: 'update',
          entity: 'index',
          targetId: ch.id,
          after: { adds: [{ entityId: oldCat.id, chapterId: ch.id }] },
          source: { quote: '老周回头瞪了他一眼，示意噤声。' }
        }
      ]
    })
    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.spyOn(http, 'fetch').mockImplementation(async (url, init) => {
      fetchCalls.push({
        url: String(url),
        body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
      })
      return sseResponse(organizeSse(proposalJson), 23)
    })

    // —— 2. 上下文装配（useOrganize 的镜像：读通道 → 装配 → 提示词） ——
    const aiData = readAiData(p)
    expect(aiData.meta).toEqual({ name: '星海拾荒者', synopsis: SYNOPSIS }) // P1 投影进入链路
    const assembled = assembleAiContext({
      book: {
        meta: {
          id: '',
          name: aiData.meta.name,
          type: 'novel',
          formatVersion: 2,
          config: { wordCountGoal: 0, dailyGoal: 0, autoSave: false, autoSaveInterval: 0 },
          synopsis: ''
        },
        volumes: listVolumes(p),
        outlineNotes: aiData.meta.synopsis, // useOrganize 同款接线（P1 消费端）
        chapters: listChapters(p).map((c) => ({
          id: c.id,
          title: c.title,
          volumeId: c.volumeId ?? null,
          order: c.order
        }))
      },
      currentChapterId: ch.id,
      chapterBody: ch.content,
      chapterSummaries: aiData.chapterSummaries,
      volumeSummaries: aiData.volumeSummaries,
      entityIndex: aiData.entityIndex,
      entityCards: { character: listCharacters(p), world: listWorldEntries(p) },
      budgetTokens: 24000
    })
    const messages: AiMessage[] = buildOrganizePrompt({
      assembled,
      chapterTitle: ch.title,
      chapterId: ch.id,
      pendingForeshadows: readLedger(p).entries.filter((e) => e.status === 'open')
    })

    // —— 3. 真 chatService × 假网络：startChat(feature organize) 收全文 ——
    const { events, sender, terminal } = makeSender()
    const accepted = startChat(sender, {
      requestId: 'e2e-organize-1',
      projectPath: p,
      feature: 'organize',
      model: undefined, // 渲染层同款：主进程按 models.organize > defaultModel 解析
      messages,
      maxTokens: budgetToMaxTokens(24000),
      timeoutMs: 180_000
    })
    expect(accepted).toEqual({ accepted: true })
    await terminal
    expect(events.map((e) => e.channel)).toContain('ai:done')
    expect(events.some((e) => e.channel === 'ai:error')).toBe(false)
    const text = events
      .filter((e) => e.channel === 'ai:chunk')
      .map((e) => String(e.payload.text))
      .join('')
    expect(text).toBe(proposalJson) // 分片流重组逐字节还原
    // 请求面三钉：URL 走 openai 兼容路径 / 模型解析取 organize 覆盖 / system 携装配层+契约
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe('https://e2e.invalid.test/chat/completions')
    expect(fetchCalls[0].body.model).toBe('e2e-organize-model')
    const sys = messages[0].content
    expect(sys).toContain('【输出规约】')
    expect(sys).toContain(SYNOPSIS) // P1 大纲层不再空——梗概经 meta 进入上下文
    // 用量账本顺带落盘（chatService 侧写，projectPath 在请求里）
    expect(readFileSync(join(p, '.ai', 'usage.jsonl'), 'utf8')).toContain('"feature":"organize"')

    // —— 4. 纯函数盖章 + 通道落盘 ——
    const built = buildProposalFromAi(text, ch.id, 'e2e-organize-model')
    expect(built.kind).toBe('ok')
    if (built.kind !== 'ok') return
    const file = built.file
    expect(file.changes.every((c) => c.source.chapterId === ch.id)).toBe(true)
    const saved = (await getHandler('proposal:save')(null, {
      projectPath: p,
      file
    })) as ProposalFile
    expect(saved.id).toBe(file.id)
    expect(existsSync(proposalPath(p, file.id))).toBe(true)

    // —— 5. PROPOSAL_DUPLICATE：同章第二份（模拟双窗口）引擎侧拒落 ——
    const dup: ProposalFile = { ...file, id: `${file.id}-second` }
    await expect(
      Promise.resolve().then(() => getHandler('proposal:save')(null, { projectPath: p, file: dup }))
    ).rejects.toThrow(`PROPOSAL_DUPLICATE: ${ch.id}`)
    expect(existsSync(proposalPath(p, dup.id))).toBe(false)

    // —— 6. 采纳：3 条全收，confirmed=[]（剧本无人写覆盖条目） ——
    const result = adoptChanges(p, file.id, [0, 1, 2], []) as ProposalAdoptResult
    expect(result).toEqual({ applied: [0, 1, 2], refused: [] })

    // —— 7. 四路落盘断言 ——
    const fresh = listCharacters(p).find((c) => c.name === '新配角')
    expect(fresh, 'create×character 未落盘').toBeDefined()
    expect(fresh?.aiTouched).toEqual(['name', 'gender', 'age', 'role', 'appearance', 'personality'])
    // 裁定 A：AI 产字段入册记名——background 空串 / relationships 空数组不入账
    expect(fresh?.background).toBe('')

    const summary = readYamlFile<Record<string, unknown>>(chapterSummaryFile(p, ch.id))
    expect(summary).toMatchObject({
      chapterId: ch.id,
      text: '老周引路，拾荒队初入星环带，遭遇不明斗篷人。',
      aiModel: 'e2e-organize-model'
    })

    const index = JSON.parse(readFileSync(join(p, '.ai', 'index.json'), 'utf8')) as Record<
      string,
      string[]
    >
    expect(index[oldCat.id]).toEqual([ch.id])

    const settled = getProposal(p, file.id)
    expect(settled?.status).toBe('settled')
    expect(settled?.appliedIndexes).toEqual([0, 1, 2])

    // —— 8. 闭环回流：readAiData 复读，下一轮整理能看见本轮产物 ——
    const after = readAiData(p)
    expect(after.chapterSummaries[ch.id]).toBe('老周引路，拾荒队初入星环带，遭遇不明斗篷人。')
    expect(after.entityIndex[oldCat.id]).toEqual([ch.id])

    // 已消化章可再整理（settled 不拦）：第三份 save 放行——闸门口径与 P2 测试一致
    const rebuilt: ProposalFile = {
      ...file,
      id: `${file.id}-third`,
      status: 'pending',
      appliedIndexes: undefined
    }
    const okAgain = (await getHandler('proposal:save')(null, {
      projectPath: p,
      file: rebuilt
    })) as ProposalFile
    expect(okAgain.status).toBe('pending')
    // 清理演示用的第二份提案：走通道 reject 全条目 → 整份删除（提案文件生命周期的收口一钉）
    await getHandler('proposal:reject')(null, {
      projectPath: p,
      proposalId: okAgain.id,
      changeIndexes: [0, 1, 2]
    })
    expect(existsSync(proposalPath(p, okAgain.id))).toBe(false)
  })
})
