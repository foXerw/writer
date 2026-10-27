// AI 用量账本（M4a Task 4）：每本书 <book>/.ai/usage.jsonl 的追加与聚合读取。
//
// 形状纪律：
// - 每行一个 JSON.stringify(AiUsageRecord)（JSON 字符串永不含裸换行，行式格式自洽）；
// - 追加 = fs.appendFileSync + mkdir -p，绝不回读旧文件（写路径 O(1)、无读-改-写竞态）；
// - 读路径容错：缺文件/不可读 → 全零摘要；单行损坏/字段类型漂移 → 跳过该行继续——
//   账本是展示性统计，绝不让坏行炸掉面板；
// - 写失败只 warn（errno 形状同 settings.ts：不回显内容），用量记账失败不能吞掉对话结果。
//
// 安全不变量：账本与摘要只含计数/模型名/feature，永不含请求正文与密钥。
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiFeature, AiUsageRecord, AiUsageSummary } from '../../../src/common/ai-types'

const USAGE_DIR = '.ai'
const USAGE_FILE = 'usage.jsonl'

const FEATURES: readonly AiFeature[] = ['organize', 'completion', 'review']

function usageFilePath(projectPath: string): string {
  return join(projectPath, USAGE_DIR, USAGE_FILE)
}

function zeroCounter(): { calls: number; prompt: number; completion: number; cached: number } {
  return { calls: 0, prompt: 0, completion: 0, cached: 0 }
}

/** 空摘要（缺文件/坏文件的回退值）；byFeature 三个 feature 恒有键（渲染层免判空）。 */
export function emptyUsageSummary(): AiUsageSummary {
  const byFeature = {} as Record<AiFeature, AiUsageSummary['total']>
  for (const f of FEATURES) byFeature[f] = zeroCounter()
  return { byFeature, total: zeroCounter(), byModel: {} }
}

/** 追加一条用量记录；任何失败（只读目录/路径失效）warn 后吞掉——绝不打断调用方。 */
export function appendUsage(projectPath: string, rec: AiUsageRecord): void {
  try {
    mkdirSync(join(projectPath, USAGE_DIR), { recursive: true })
    appendFileSync(usageFilePath(projectPath), JSON.stringify(rec) + '\n', 'utf-8')
  } catch (err) {
    console.warn(
      `[ai/usage] 用量账本写入失败（errno=${String((err as NodeJS.ErrnoException).code ?? 'UNKNOWN')}），已跳过记账`
    )
  }
}

function nonNegativeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/** 读全量账本并聚合；缺文件/不可读 → 全零；坏行/形状漂移行静默跳过。 */
export function readUsageSummary(projectPath: string): AiUsageSummary {
  const summary = emptyUsageSummary()
  let text: string
  try {
    text = readFileSync(usageFilePath(projectPath), 'utf-8')
  } catch {
    return summary // 缺文件是常态（从未用过 AI），不值得 warn 噪音
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue // 半行/坏 JSON：跳过
    }
    const rec = parsed as Partial<AiUsageRecord> | null
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) continue
    if (typeof rec.feature !== 'string' || !FEATURES.includes(rec.feature as AiFeature)) continue
    if (typeof rec.model !== 'string' || rec.model === '') continue
    const prompt = nonNegativeNumber(rec.promptTokens)
    const completion = nonNegativeNumber(rec.completionTokens)
    const cached = nonNegativeNumber(rec.cachedTokens)
    const feature = rec.feature as AiFeature
    for (const bucket of [summary.byFeature[feature], summary.total]) {
      bucket.calls += 1
      bucket.prompt += prompt
      bucket.completion += completion
      bucket.cached += cached
    }
    const modelBucket = summary.byModel[rec.model] ?? (summary.byModel[rec.model] = { prompt: 0, completion: 0 })
    modelBucket.prompt += prompt
    modelBucket.completion += completion
  }
  return summary
}
