// 宽容 JSON 解析测试（原 providers.test.ts「extractJsonLoose 四路」describe 整体迁移至此——
// M4b Task 4 裁定 3：函数从 electron/main/ai/providers/types.ts 移到 src/common/jsonLoose.ts，
// 主/渲染共用、单一来源、无 re-export shim）。
// 唯一形状变化：抛出类型由主进程的 AiCallError 改为本模块的 JsonExtractError（src/common 不得
// 依赖 electron/main）；kind 词表语义逐字保留（'provider' + 固定文案，绝不回显原文）。
import { describe, expect, it } from 'vitest'
import { JsonExtractError, extractJsonLoose } from './jsonLoose'

describe('extractJsonLoose 四路', () => {
  it('裸 JSON', () => {
    expect(extractJsonLoose('{"a":1,"b":{"c":2}}')).toEqual({ a: 1, b: { c: 2 } })
  })

  it('```json 围栏 + 前后杂话', () => {
    expect(extractJsonLoose('好的：\n```json\n{"a":1}\n```\n以上。')).toEqual({ a: 1 })
  })

  it('无语言标注围栏', () => {
    expect(extractJsonLoose('```\n{"x":true}\n```')).toEqual({ x: true })
  })

  it('裸花括号截取：字符串感知的平衡扫描（串内大括号不算数）', () => {
    const raw = '前置说明 {"note":"这里有 } 大括号","ok":{"deep":[1,2]}} 后面还有话'
    expect(extractJsonLoose(raw)).toEqual({ note: '这里有 } 大括号', ok: { deep: [1, 2] } })
  })

  it('坏输入 → JsonExtractError kind provider + 固定文案', () => {
    for (const bad of ['完全不是 JSON', '{"a":1', '']) {
      try {
        extractJsonLoose(bad)
        expect.unreachable(`应抛出：${bad}`)
      } catch (err) {
        expect(err).toBeInstanceOf(JsonExtractError)
        expect((err as JsonExtractError).kind).toBe('provider')
        expect((err as JsonExtractError).message).toBe('无法解析模型输出的 JSON')
      }
    }
  })
})
