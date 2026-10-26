// Task 9 修订 ①：冲突「内容比对」判定的纯函数钉死（控制器改判的两种结局都在此固定）——
// 自写回声（磁盘 === lastSaved）绝不弹窗；真外部改动（磁盘 ≠ lastSaved）必弹窗。
// watcher 侧的事件合并/失效仍由 electron/main/bookStore/watcher.test.ts（真实 fs.watch）钉死。
import { describe, expect, it } from 'vitest'
import { bookChangeTouchesCurrentChapter, decideConflict } from './bookChangeConflict'

describe('bookChangeTouchesCurrentChapter', () => {
  const id = 'aaaaaaaa-1111-4111-8111-111111111111'

  it('paths 含当前章文件（chapters/<id>.md）→ true', () => {
    expect(bookChangeTouchesCurrentChapter([`chapters/${id}.md`], id)).toBe(true)
    expect(bookChangeTouchesCurrentChapter(['volumes/v.yaml', `chapters/${id}.md`], id)).toBe(true)
  })

  it('只含其他章/其他域路径，或无当前章 → false', () => {
    const other = 'bbbbbbbb-2222-4222-8222-222222222222'
    expect(bookChangeTouchesCurrentChapter([`chapters/${other}.md`], id)).toBe(false)
    expect(bookChangeTouchesCurrentChapter(['world/location/x.yaml', 'foreshadow.yaml'], id)).toBe(false)
    expect(bookChangeTouchesCurrentChapter([`chapters/${id}.md`], null)).toBe(false)
  })
})

describe('decideConflict（修订 ①：内容比对，两种结局钉死）', () => {
  it('脏 + 自写回声（磁盘 === lastSaved）→ ignore-echo：不弹窗、不刷新抖动', () => {
    // 场景：自动保存刚写盘 → 用户继续打字（dirty）→ 300ms 后自己的回声事件到达
    expect(decideConflict('# 章\n\n正文。\n', '# 章\n\n正文。\n')).toBe('ignore-echo')
  })

  it('脏 + 真外部改动（磁盘 ≠ lastSaved）→ open-conflict-modal', () => {
    // 场景：外部编辑器改了当前脏章 → 磁盘内容与我们最后一次写盘不同
    expect(decideConflict('外部改写的内容。\n', '# 章\n\n正文。\n')).toBe('open-conflict-modal')
  })

  it('磁盘点读 null（章被外删/坏档/点读失败）→ open-conflict-modal：宁可多问，绝不静默丢编辑', () => {
    expect(decideConflict(null, '# 章\n\n正文。\n')).toBe('open-conflict-modal')
  })

  it('基准缺失（lastSaved=null，理论上不可达的防御分支）→ open-conflict-modal', () => {
    expect(decideConflict('任何内容', null)).toBe('open-conflict-modal')
    expect(decideConflict(null, null)).toBe('open-conflict-modal')
  })
})
