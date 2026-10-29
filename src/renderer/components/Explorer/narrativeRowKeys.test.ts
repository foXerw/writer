// 稳定行键与载荷剥离的纯逻辑单测（合并后加固批 item 2，无 jsdom）：
// ① _k 赋键纪律：载入/新增逐行唯一、单调递增；删中间行幸存行的键不重指派（焦点/IME 稳定的根）；
// ② 保存转换必须剥净 _k——泄漏进 IPC 写面会撞主进程严格形状校验或污染盘上 YAML；
//    转换函数的输出形状用 Object.keys 钉死为 schema 恰有字段，trim 语义原样保留。
import { describe, expect, it } from 'vitest'
import type { ChoiceOption, PlotlineStage } from '@/common/schema'
import {
  keyOptions,
  keyStages,
  newOptionRow,
  newStageRow,
  nextRowKey,
  optionRowToOption,
  stageRowToStage
} from './narrativeRowKeys'

describe('row key assignment', () => {
  it('nextRowKey 单调递增且互不重复', () => {
    const a = nextRowKey()
    const b = nextRowKey()
    const c = nextRowKey()
    expect(new Set([a, b, c]).size).toBe(3)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })

  it('keyStages 逐行赋唯一 _k，字段内容保留且数组与存量对象脱钩', () => {
    const stages: PlotlineStage[] = [
      { title: '起', summary: '开场', chapterIds: ['c1'], entityIds: [] },
      { title: '承', summary: '', chapterIds: [], entityIds: ['e1'] }
    ]
    const rows = keyStages(stages)
    expect(rows.map((r) => r.title)).toEqual(['起', '承'])
    expect(new Set(rows.map((r) => r._k)).size).toBe(2)
    rows[0]!.chapterIds.push('c2') // 行编辑不回写存量 plotline 对象
    expect(stages[0]!.chapterIds).toEqual(['c1'])
  })

  it('keyOptions 逐行赋唯一 _k，label/consequence 原样', () => {
    const options: ChoiceOption[] = [
      { label: '过桥', consequence: '落水' },
      { label: '绕路', consequence: '' }
    ]
    const rows = keyOptions(options)
    expect(rows.map((r) => r.label)).toEqual(['过桥', '绕路'])
    expect(new Set(rows.map((r) => r._k)).size).toBe(2)
  })

  it('新增空行自带 _k（与初始字段同批赋值，绝不漏键回落 index 姿态）', () => {
    expect(newStageRow()._k).toBeTypeOf('number')
    expect(newOptionRow()._k).toBeTypeOf('number')
  })

  it('删中间行：幸存行的 _k 原样不动（key={index} 病灶的回归钉）', () => {
    const rows = keyStages([
      { title: '起', summary: '', chapterIds: [], entityIds: [] },
      { title: '承', summary: '', chapterIds: [], entityIds: [] },
      { title: '转', summary: '', chapterIds: [], entityIds: [] }
    ])
    const keys = rows.map((r) => r._k)
    const afterDelete = rows.filter((_, i) => i !== 1).map((r) => r._k)
    expect(afterDelete).toEqual([keys[0], keys[2]])
  })
})

describe('save payload strips _k', () => {
  it('stageRowToStage 输出恰为 PlotlineStage 四字段：无 _k，title 经 trim', () => {
    const row = {
      ...newStageRow(),
      title: '  起  ',
      summary: '开场',
      chapterIds: ['c1'],
      entityIds: ['e1']
    }
    const stage = stageRowToStage(row)
    expect(Object.keys(stage).sort()).toEqual(['chapterIds', 'entityIds', 'summary', 'title'])
    expect('_k' in stage).toBe(false)
    expect(stage).toEqual({ title: '起', summary: '开场', chapterIds: ['c1'], entityIds: ['e1'] })
  })

  it('optionRowToOption 输出恰为 ChoiceOption 两字段：无 _k，label 经 trim、consequence 兜底空串', () => {
    const row = { ...newOptionRow(), label: ' 过桥 ', consequence: '落水' }
    const option = optionRowToOption(row)
    expect(Object.keys(option).sort()).toEqual(['consequence', 'label'])
    expect('_k' in option).toBe(false)
    expect(option).toEqual({ label: '过桥', consequence: '落水' })
    const bare = optionRowToOption({ _k: 1, label: '桥', consequence: undefined as unknown as string })
    expect(bare).toEqual({ label: '桥', consequence: '' })
  })
})
