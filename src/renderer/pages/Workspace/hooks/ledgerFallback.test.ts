// 台账读容错两形态的纯逻辑单测（R1 + Task 7 收口裁定，无 jsdom）：
// withLedgerFallback（图谱侧只读）——抛穿 → EMPTY_LEDGER + console.warn 留痕（带原 error），
// 成功读原样透传且不告警；同步抛/非 Error 抛值同样被隔离，绝不把 reject 传回 Promise.all。
// withLedgerLoudError（整理侧花 token）——抛穿必须继续抛（fail-loud 不吞），只把消息换成
// narrativeErrorText 中文可读；console.error 留原 error 供诊断。
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForeshadowEntry, ForeshadowLedger } from '@/common/schema'
import { EMPTY_LEDGER, withLedgerFallback, withLedgerLoudError } from './ledgerFallback'

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

describe('withLedgerLoudError（整理侧：fail-loud + 中文可读）', () => {
  it('读取成功：原样透传同一对象，不告警不报错', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ledger: ForeshadowLedger = { entries: [entry()] }
    await expect(withLedgerLoudError(() => Promise.resolve(ledger))).resolves.toBe(ledger)
    expect(err).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('坏台账 reject → 继续抛（绝不吞成空台账），消息中文归一、console.error 留原 error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const cause = new Error(
      "Error invoking remote method 'foreshadow:get': Error: FORESHADOW_INVALID: /book/foreshadow.yaml: ledger.entries[0]: foreshadowEntry.status: expected one of [open, resolved, abandoned], got string"
    )
    const p = withLedgerLoudError(() => Promise.reject(cause))
    await expect(p).rejects.toBeInstanceOf(Error)
    await expect(p).rejects.toThrow(/^伏笔台账数据已损坏，应用未做任何修改：/)
    const thrown = (await p.catch((e: unknown) => e as Error)) as Error
    expect(thrown.message).toContain('ledger.entries[0]') // detail 保留可诊断性
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0]![1]).toBe(cause) // 留痕是【原】error，非翻译壳
  })

  it('非台账前缀的意外抛错：不吞、回落「操作失败：<原文>」面呈，原样上抛链不断', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      withLedgerLoudError(() => Promise.reject(new Error('IPC_STREAM_BROKEN: connection reset')))
    ).rejects.toThrow(/^操作失败：IPC_STREAM_BROKEN: connection reset$/)
  })

  // 合并后加固批 item 1：中文重抛壳不丢原 error——console.error 留痕之外，cause 链也可编程追溯。
  it('重抛壳保留 cause：原 error（Error 抛值）可编程追溯', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const original = new Error('FORESHADOW_INVALID: /book/foreshadow.yaml: boom')
    const p = withLedgerLoudError(() => Promise.reject(original))
    const thrown = (await p.catch((e: unknown) => e)) as Error & { cause?: unknown }
    expect(thrown.message).toMatch(/^伏笔台账数据已损坏/)
    expect(thrown.cause).toBe(original)
  })

  it('重抛壳保留 cause：非 Error 抛值同样挂进 cause 链', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const p = withLedgerLoudError(() => Promise.reject('bare string'))
    const thrown = (await p.catch((e: unknown) => e)) as Error & { cause?: unknown }
    expect(thrown.message).toBe('操作失败：bare string')
    expect(thrown.cause).toBe('bare string')
  })
})
