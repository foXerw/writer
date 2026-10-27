// entityEvents 单测（M3 终审整改 FI-1）：emit/subscribe/unsubscribe 三条语义钉死——
// 面板保存成功 → 图谱刷新这条链的最内环（纯模块，无 React/IPC 依赖，node 环境直测）。
import { describe, expect, it, vi } from 'vitest'
import { notifyEntitiesChanged, subscribeEntitiesChanged } from './entityEvents'

describe('entityEvents（渲染层实体变更广播）', () => {
  it('订阅后 notify 触发回调；多监听器全部收到', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unA = subscribeEntitiesChanged(a)
    const unB = subscribeEntitiesChanged(b)
    try {
      notifyEntitiesChanged()
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
      notifyEntitiesChanged()
      expect(a).toHaveBeenCalledTimes(2)
      expect(b).toHaveBeenCalledTimes(2)
    } finally {
      unA()
      unB()
    }
  })

  it('反订阅后不再收到通知；重复反订阅无害', () => {
    const cb = vi.fn()
    const un = subscribeEntitiesChanged(cb)
    notifyEntitiesChanged()
    expect(cb).toHaveBeenCalledTimes(1)
    un()
    notifyEntitiesChanged()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(() => un()).not.toThrow()
  })

  it('同一函数重复订阅只挂一份（Set 语义），notify 只触发一次', () => {
    const cb = vi.fn()
    const un1 = subscribeEntitiesChanged(cb)
    const un2 = subscribeEntitiesChanged(cb)
    try {
      notifyEntitiesChanged()
      expect(cb).toHaveBeenCalledTimes(1)
    } finally {
      un1()
      un2()
    }
  })

  it('某个监听器抛错被隔离：其余监听器照常收到，notify 本身不抛', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const bad = () => {
      throw new Error('boom')
    }
    const good = vi.fn()
    const unBad = subscribeEntitiesChanged(bad)
    const unGood = subscribeEntitiesChanged(good)
    try {
      expect(() => notifyEntitiesChanged()).not.toThrow()
      expect(good).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalled()
    } finally {
      unBad()
      unGood()
      spy.mockRestore()
    }
  })
})
