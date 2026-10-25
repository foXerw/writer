// character:* handler 级测试（Task 6）：vi.mock('electron') 捕获注册后直接调用，
// 钉死「5 通道薄委托 + 参数形状 {projectPath, character}」与错误语义透传——
// REF_BROKEN: <targetId>（本补丁新引入的幻影引用）原样抛到通道外；delete 按幂等契约返回 false。
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkTmpBook } from '../../../../tests/tmp'
import type { CharacterV2 } from '../../../../src/common/schema'
import { randomUUID } from 'node:crypto'

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => Promise<unknown>
    ): void => {
      handlers.set(channel, listener)
    }
  }
}))

import { registerCharacterHandlers } from './character'
import { createVolume } from '../../bookStore/volumes'

beforeAll(() => {
  registerCharacterHandlers()
})

function getHandler(channel: string) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn
}

describe('character:* handlers 委托', () => {
  it('create→getAll→getById→update→delete 全链路走 v2 人物卡仓库语义', async () => {
    const p = mkTmpBook()
    const a = (await getHandler('character:create')(null, {
      projectPath: p,
      character: { name: '阿明', gender: 'male', role: 'protagonist', appearance: '黑发' }
    })) as CharacterV2
    const b = (await getHandler('character:create')(null, {
      projectPath: p,
      character: { name: '小雅', gender: 'female', role: 'supporting' }
    })) as CharacterV2
    expect(a.appearance).toBe('黑发') // create 通道的整张 Partial 经 init 一次落盘
    expect(b.relationships).toEqual([])

    const list = (await getHandler('character:getAll')(null, p)) as CharacterV2[]
    // 顺序（createdAt 升序）已在仓库层测试钉死；同毫秒新建时 stem 平局无定序，这里只断成员
    expect(list.map((c) => c.name).sort()).toEqual(['小雅', '阿明'].sort())
    const single = (await getHandler('character:getById')(null, {
      projectPath: p,
      characterId: a.id
    })) as CharacterV2
    expect(single.name).toBe('阿明')

    // 指向存在卷的边 → 通道放行（合法目标集含卷）
    const vol = createVolume(p, '第一卷')
    const updated = (await getHandler('character:update')(null, {
      projectPath: p,
      character: { ...b, relationships: [{ targetId: vol.id, kind: '属于' }] }
    })) as CharacterV2
    expect(updated.relationships).toHaveLength(1)

    expect(await getHandler('character:delete')(null, { projectPath: p, characterId: a.id })).toBe(
      true
    )
    expect(await getHandler('character:delete')(null, { projectPath: p, characterId: a.id })).toBe(
      false
    )
  })

  it('REF_BROKEN 透传：update 带不存在 targetId → 通道外消息原样；坏形状 characterId delete 返回 false', async () => {
    const p = mkTmpBook()
    const c = (await getHandler('character:create')(null, {
      projectPath: p,
      character: { name: '甲' }
    })) as CharacterV2
    const ghost = randomUUID()

    // 仓库为同步实现：坏引用在 handler 内同步抛（真实 Electron 把它转为 rejected Promise），
    // 测试经微任务桥接后按 rejects 断言（镜像 volume.test.ts 的 BAD_VOLUME_ID 用例）
    await expect(
      Promise.resolve().then(() =>
        getHandler('character:update')(null, {
          projectPath: p,
          character: { ...c, relationships: [{ targetId: ghost, kind: '仇敌' }] }
        })
      )
    ).rejects.toThrow(`REF_BROKEN: ${ghost}`)
    // 磁盘未动：重新 getAll，relationships 仍空
    const list = (await getHandler('character:getAll')(null, p)) as CharacterV2[]
    expect(list[0].relationships).toEqual([])

    expect(
      await getHandler('character:delete')(null, { projectPath: p, characterId: '../../evil' })
    ).toBe(false)
  })
})
