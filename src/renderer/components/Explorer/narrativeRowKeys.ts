// NarrativePanel 两段行编辑器（剧情阶段 / 分支选项）的稳定行键（合并后加固批 item 2）。
// 病灶：key={index} 在删中间行时让 React 复用错位行组件——焦点跳、IME 合成串被截
//（中文作者 + IME 是本应用核心用户，非 cosmetic）。解法：行对象自带单调递增 _k，
// 载入/新增时赋值一次，编辑（spread 保留）与删除（幸存行不重指派）永不动它，React key 用它。
// _k 只活在组件态：保存载荷一律经 stageRowToStage / optionRowToOption 显式重建整张
// schema 形状（PlotlineStage 恰四字段、ChoiceOption 恰两字段），_k 无从夹带进 IPC 写面。
// 抽成纯函数供无 jsdom 单测钉死剥离纪律，镜像 ledgerFallback.ts / chapterRefresh.ts 先例。
import type { ChoiceOption, PlotlineStage } from '@/common/schema'

/** 组件态行 = schema 行 + 稳定 React 键（绝不进保存载荷）。 */
export type StageRow = PlotlineStage & { _k: number }
export type OptionRow = ChoiceOption & { _k: number }

let rowKeySeq = 0

/** 单调递增行键（只需同列表内互异；跨面板实例共享计数器无害）。 */
export function nextRowKey(): number {
  return ++rowKeySeq
}

/** 编辑弹窗载入存量阶段：逐行赋 _k，数组照原姿态拷贝（与存量对象脱钩）。 */
export function keyStages(stages: PlotlineStage[]): StageRow[] {
  return stages.map((s) => ({
    ...s,
    chapterIds: [...s.chapterIds],
    entityIds: [...s.entityIds],
    _k: nextRowKey()
  }))
}

/** 编辑弹窗载入存量分支：逐行赋 _k。 */
export function keyOptions(options: ChoiceOption[]): OptionRow[] {
  return options.map((o) => ({ ...o, _k: nextRowKey() }))
}

/** 「添加阶段」空行：_k 与初始字段同批赋值。 */
export function newStageRow(): StageRow {
  return { _k: nextRowKey(), title: '', summary: '', chapterIds: [], entityIds: [] }
}

/** 「添加分支」空行：_k 与初始字段同批赋值。 */
export function newOptionRow(): OptionRow {
  return { _k: nextRowKey(), label: '', consequence: '' }
}

/** 保存转换：显式重建 PlotlineStage 四字段（title trim 语义原样），_k 不在输出形状内。 */
export function stageRowToStage(row: StageRow): PlotlineStage {
  return {
    title: row.title.trim(),
    summary: row.summary ?? '',
    chapterIds: row.chapterIds,
    entityIds: row.entityIds
  }
}

/** 保存转换：显式重建 ChoiceOption 两字段（label trim 语义原样），_k 不在输出形状内。 */
export function optionRowToOption(row: OptionRow): ChoiceOption {
  return {
    label: row.label.trim(),
    consequence: row.consequence ?? ''
  }
}
