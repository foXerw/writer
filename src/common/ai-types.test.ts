// ai-types 纯函数契约测试（M4a Task 2）：maskKey 掩码边界 + isConfigured 判定。
// maskKey 是「密钥永不过 IPC」的渲染层最后防线形状，边界（空串/8 字符）必须钉死。
import { describe, expect, it } from 'vitest'
import type { AiProtocol, AiSettings } from './ai-types'
import { isConfigured, maskKey } from './ai-types'

function settings(over: Partial<AiSettings> = {}): AiSettings {
  return {
    protocol: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-abcdef1234567890',
    defaultModel: 'gpt-test',
    models: {},
    ...over
  }
}

describe('maskKey', () => {
  it('空串 → 空串（未设置密钥不显示占位点）', () => {
    expect(maskKey('')).toBe('')
  })

  it('短密钥（1~8 字符，含 8 边界）→ 统一 ••••，绝不泄露任何明文片段', () => {
    expect(maskKey('a')).toBe('••••')
    expect(maskKey('abcdefg')).toBe('••••')
    expect(maskKey('abcdefgh')).toBe('••••') // 恰 8 字符：仍全遮
  })

  it('9 字符起 → 前3…后4', () => {
    expect(maskKey('abcdefghi')).toBe('abc…fghi')
    expect(maskKey('sk-abcdef1234567890')).toBe('sk-…7890')
  })

  it('掩码结果不含完整密钥的任何中段字符', () => {
    const key = 'sk-supersecret-token-9999'
    const masked = maskKey(key)
    expect(masked).toBe('sk-…9999')
    expect(masked).not.toContain('supersecret')
  })
})

describe('isConfigured', () => {
  it('三项齐全 → true', () => {
    expect(isConfigured(settings())).toBe(true)
  })

  it('baseUrl 空串 → false', () => {
    expect(isConfigured(settings({ baseUrl: '' }))).toBe(false)
  })

  it('apiKey 空串 → false（有 key 才算配置完成）', () => {
    expect(isConfigured(settings({ apiKey: '' }))).toBe(false)
  })

  it('protocol 空（运行时脏数据，越类型传入）→ false', () => {
    expect(isConfigured(settings({ protocol: '' as unknown as AiProtocol }))).toBe(false)
  })
})
