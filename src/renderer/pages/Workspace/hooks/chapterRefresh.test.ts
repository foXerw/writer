// planChapterRefresh 纯逻辑单测（Task 5 评审整改第 3 条，无 jsdom）：
// 钉死「刷新保留 tab 布局」新语义——成员换新鲜对象/被删掉出/当前章重同步/
// 当前章被删不再由本函数选tab（调用方接管）/autoOpenFirst 仅首载空会话发生一次。
import { describe, expect, it } from 'vitest'
import type { Chapter } from '@/common/ipc'
import { planChapterRefresh } from './chapterRefresh'

function ch(id: string, over?: Partial<Chapter>): Chapter {
  return {
    id,
    title: `章${id}`,
    content: `# 章${id}\n\n`,
    volumeId: null,
    order: Number(id),
    status: 'draft',
    wordCount: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over
  }
}

describe('planChapterRefresh', () => {
  it('tab 布局保留：成员替换为磁盘新鲜对象（顺序不变），当前章重同步', () => {
    const a = ch('1')
    const b = ch('2')
    const aFresh = { ...a, volumeId: 'volA' }
    const plan = planChapterRefresh({
      opened: [a, b],
      currentId: a.id,
      fresh: [aFresh, b, ch('3')],
      hasAutoOpened: true
    })
    expect(plan.tabs.map((c) => c.id)).toEqual(['1', '2'])
    expect(plan.tabs[0]).toBe(aFresh) // 新鲜对象整体替换（含 volumeId）
    expect(plan.current).toBe(aFresh)
    expect(plan.autoOpenFirst).toBe(false)
  })

  it('被删章从 tab 顺位掉出', () => {
    const a = ch('1')
    const b = ch('2')
    const plan = planChapterRefresh({ opened: [a, b], currentId: '2', fresh: [b], hasAutoOpened: true })
    expect(plan.tabs.map((c) => c.id)).toEqual(['2'])
    expect(plan.current).toBe(b)
  })

  it('当前章被删：current=null，由调用方决定顺位/清空（有剩余 tab 时本函数不误报 autoOpen）', () => {
    const b = ch('2')
    const plan = planChapterRefresh({ opened: [ch('1'), b], currentId: '1', fresh: [b], hasAutoOpened: true })
    expect(plan.current).toBeNull()
    expect(plan.tabs.map((c) => c.id)).toEqual(['2'])
    expect(plan.autoOpenFirst).toBe(false)
  })

  it('autoOpenFirst 仅「从未自动打开 + 会话全空 + 盘上有章」时为真', () => {
    const data = [ch('1'), ch('2')]
    expect(planChapterRefresh({ opened: [], currentId: null, fresh: data, hasAutoOpened: false }).autoOpenFirst).toBe(true)
    // 已自动打开过（或用户主动关光 tab）后的刷新 → 永不再强行开章
    expect(planChapterRefresh({ opened: [], currentId: null, fresh: data, hasAutoOpened: true }).autoOpenFirst).toBe(false)
    // 有 tab 或有当前章 → 不算首载
    expect(planChapterRefresh({ opened: [data[0]], currentId: null, fresh: data, hasAutoOpened: false }).autoOpenFirst).toBe(false)
    expect(planChapterRefresh({ opened: [], currentId: '1', fresh: data, hasAutoOpened: false }).autoOpenFirst).toBe(false)
    // 空书
    expect(planChapterRefresh({ opened: [], currentId: null, fresh: [], hasAutoOpened: false }).autoOpenFirst).toBe(false)
  })

  it('盘上不存在的新鲜度：fresh 缺谁的 id，谁的 tab 项就掉出（外部删章 + 列表刷新同一路径）', () => {
    const plan = planChapterRefresh({ opened: [ch('1'), ch('2')], currentId: '1', fresh: [], hasAutoOpened: true })
    expect(plan.tabs).toEqual([])
    expect(plan.current).toBeNull()
  })
})
