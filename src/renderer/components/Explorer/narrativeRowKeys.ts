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

/**
 * PlotlineStage 重建式（stageRowToStage 的真实输出形状）：显式四字段（title trim 语义
 * 原样），_k 不在输出形状内。
 * ⚠ 漂移门（结转微批 #2 注记，#4 升级为编译锁）：PlotlineStage 新增字段未同步进此重建式
 * 时，文末 StageConverterLock 的 Exclude 变非 never，tsc 当场报错——不再静默丢字段；
 * Object.keys 等值测试仍只钉今天的形状，运行态镜像见往返零丢失单测。
 */
function buildStageOut(row: StageRow) {
  return {
    title: row.title.trim(),
    summary: row.summary ?? '',
    chapterIds: row.chapterIds,
    entityIds: row.entityIds
  }
}

/** 保存转换：委托 buildStageOut；`: PlotlineStage` 标注保留可赋值性硬门（缺必填/错类型当场报错）。 */
export function stageRowToStage(row: StageRow): PlotlineStage {
  return buildStageOut(row)
}

/**
 * ChoiceOption 重建式（optionRowToOption 的真实输出形状）：显式两字段（label trim 语义
 * 原样），_k 不在输出形状内。
 * ⚠ 漂移门（结转微批 #2 注记，#4 升级为编译锁）：ChoiceOption 新增字段未同步进此重建式
 * 时，文末 OptionConverterLock 的 Exclude 变非 never，tsc 当场报错——不再静默丢字段；
 * Object.keys 等值测试仍只钉今天的形状，运行态镜像见往返零丢失单测。
 */
function buildOptionOut(row: OptionRow) {
  return {
    label: row.label.trim(),
    consequence: row.consequence ?? ''
  }
}

/** 保存转换：委托 buildOptionOut；`: ChoiceOption` 标注保留可赋值性硬门。 */
export function optionRowToOption(row: OptionRow): ChoiceOption {
  return buildOptionOut(row)
}

/**
 * 编译时漂移锁（结转微批 #4）：schema 任一字段（必填或可选）新增而未同步进上方重建式时，
 * Exclude<keyof schema, keyof 重建式输出> 变非 never，类型实参违反 `T extends never`
 * 约束，tsc 报 TS2344（错误文本直接点名缺失字段，如 Type '"scratchFoo"' does not
 * satisfy the constraint 'never'）。两处实现口径：
 * ① 题面建议的 `type _Lock = ... extends never ? true : { missing: ... }` 配局部 const
 *   实例化不可直接用——tsconfig noUnusedLocals 会把未用的局部类型/变量判 TS6196/TS6133，
 *   锁只能以导出声明存活（无人导入、存在于模块即被 tsc 检查）；约束违反与「true 不可
 *   赋给 {missing}」同为编译失败，取约束式。
 * ② 锁必须比 ReturnType<typeof buildStageOut>（无标注的重建式）而非导出函数——导出函数
 *   带 `: PlotlineStage` 返回标注时 ReturnType ≡ PlotlineStage，Exclude 恒 never、锁空转。
 */
type NeverBut<T extends never> = T
export type StageConverterLock = NeverBut<Exclude<keyof PlotlineStage, keyof ReturnType<typeof buildStageOut>>>
export type OptionConverterLock = NeverBut<Exclude<keyof ChoiceOption, keyof ReturnType<typeof buildOptionOut>>>
