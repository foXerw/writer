// useOrganize 外层 catch toast 文案归一（结转微批 #2 item 3，纯函数无 jsdom 单测）：
// narrativeErrorText 泛化回落的重抛消息已带「操作失败：<原文>」前缀（ledgerFallback.ts
// withLedgerLoudError 路径），外层 catch 再叠「整理失败：」= 双前缀病句。
// 裁定：已冠「操作失败：」开头者原样用；其余保持「整理失败：<msg>」既有形态不动。
import { describe, expect, it } from 'vitest'
import { organizeFailureText } from './organizeFailureText'

describe('organizeFailureText', () => {
  it('已冠「操作失败：」开头 → 原样透传，不再叠整理失败', () => {
    const msg = '操作失败：IPC_STREAM_BROKEN: connection reset'
    expect(organizeFailureText(msg)).toBe(msg)
  })

  it('普通消息 → 叠「整理失败：」前缀（既有 toast 形态不变）', () => {
    expect(organizeFailureText('boom')).toBe('整理失败：boom')
    // 裸「操作失败」（空原文回落形态，无冒号）不满足前缀判据 → 照叠，不算双前缀病句
    expect(organizeFailureText('操作失败')).toBe('整理失败：操作失败')
  })

  it('空串 → 「整理失败：」（保持现状形态，不发明新空串规则）', () => {
    expect(organizeFailureText('')).toBe('整理失败：')
  })
})
