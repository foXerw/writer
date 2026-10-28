// withLedgerFallback 纯逻辑单测（Task 4 评审整改 R1，无 jsdom）：
// 钉死「坏台账只降级台账这一路」——抛穿 → EMPTY_LEDGER + console.warn 留痕（带原 error），
// 成功读原样透传且不告警；同步抛/非 Error 抛值同样被隔离，绝不把 reject 传回 Promise.all。
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForeshadowEntry, ForeshadowLedger } from '@/common/schema'
import { EMPTY_LEDGER, withLedgerFallback } from './ledgerFallback'

function entry(over?: Partial<ForeshadowEntry>): ForeshadowEntry {
  return {
    id: 'f1',
    title: '伏笔一',
    plantedChapterId: 'c1',
    plannedPayoffNote: '回收于末章',
    resolvedChapterId: null,
    status: 'open',
    ...over
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('withLedgerFallback', () => {
  it('读取成功：原样透传同一对象，不告警', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ledger: ForeshadowLedger = { entries: [entry()] }
    await expect(withLedgerFallback(() => Promise.resolve(ledger))).resolves.toBe(ledger)
    expect(warn).not.toHaveBeenCalled()
  })

  it('损坏台账 reject（FORESHADOW_INVALID）→ 空台账 + warn 带原 error，不向上抛', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const err = new Error('FORESHADOW_INVALID: /book/foreshadow.yaml: ledger.entries: expected array')
    const result = await withLedgerFallback(() => Promise.reject(err))
    expect(result).toEqual({ entries: [] })
    expect(result).toBe(EMPTY_LEDGER)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![1]).toBe(err)
  })

  it('非 Error 抛值与同步抛同样被隔离', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(withLedgerFallback(() => Promise.reject('bare string'))).resolves.toBe(EMPTY_LEDGER)
    await expect(withLedgerFallback(() => {
      throw new Error('sync boom')
    })).resolves.toBe(EMPTY_LEDGER)
  })
})
