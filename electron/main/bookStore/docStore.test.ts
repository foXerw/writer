import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkTmpBook } from '../../../tests/tmp'
import { readYamlFile, writeYamlFileAtomic, listYamlFiles } from './docStore'
import {
  bookJsonPath,
  backupRoot,
  backupStamp,
  categorySlug,
  chapterFile,
  characterFile,
  foreshadowFile,
  volumeFile,
  worldEntryFile
} from './paths'

describe('writeYamlFileAtomic + readYamlFile round-trip', () => {
  it('中文键值/多行字符串写出后回读 deep-equal', () => {
    const dir = mkTmpBook()
    const abs = bookJsonPath(dir)
    const doc = {
      id: '2b7c4f1e-9a3d-4e5f-8b6c-1a2b3c4d5e6f',
      名字: '黎明号航行日志',
      synopsis: '第一行\n第二行带缩进：  「引号」与冒号: 都保留\n结尾',
      nested: { tags: ['主角', '反派'], note: '', count: 3 }
    }

    writeYamlFileAtomic(abs, doc)

    expect(readYamlFile<typeof doc>(abs)).toEqual(doc)
  })

  it('父目录不存在时自动 mkdir -p', () => {
    const dir = mkTmpBook()
    const abs = chapterFile(dir, '2b7c4f1e-9a3d-4e5f-8b6c-1a2b3c4d5e6f')

    writeYamlFileAtomic(abs, { title: '第一章' })

    expect(existsSync(join(dir, 'chapters'))).toBe(true)
    expect(readYamlFile<{ title: string }>(abs)).toEqual({ title: '第一章' })
  })

  it('原子性：写成功后目录内无 .tmp- 残留', () => {
    const dir = mkTmpBook()

    writeYamlFileAtomic(bookJsonPath(dir), { a: 1 })
    writeYamlFileAtomic(bookJsonPath(dir), { a: 2 }) // 覆盖同名目标
    writeYamlFileAtomic(characterFile(dir, 'x-id'), { b: 1 })

    for (const entry of readdirSync(dir)) {
      expect(entry).not.toContain('.tmp-')
    }
    for (const entry of readdirSync(join(dir, 'characters'))) {
      expect(entry).not.toContain('.tmp-')
    }
    expect(readYamlFile<{ a: number }>(bookJsonPath(dir))).toEqual({ a: 2 })
  })

  it('序列化失败：抛错、不留 .tmp- 残留、不创建目标文件', () => {
    const dir = mkTmpBook()
    const abs = join(dir, 'bad.yaml')

    // js-yaml v4 对函数值 dump 直接抛 YAMLException（写盘之前即失败）
    expect(() => writeYamlFileAtomic(abs, { boom: () => 1 })).toThrow()
    expect(existsSync(abs)).toBe(false)
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([])
  })
})

describe('readYamlFile 缺失文件契约', () => {
  it('不存在抛 ENOBOOK: <绝对路径> 前缀错误', () => {
    const dir = mkTmpBook()
    const missing = join(dir, 'nope.yaml')

    expect(() => readYamlFile(missing)).toThrow(`ENOBOOK: ${missing}`)
  })
})

describe('listYamlFiles', () => {
  it('目录不存在返回 []', () => {
    const dir = mkTmpBook()

    expect(listYamlFiles(join(dir, 'never-created'))).toEqual([])
  })

  it('只列 *.yaml（不含 .md/.yml/子目录），返回排序后的文件名', () => {
    const dir = mkTmpBook()
    writeFileSync(join(dir, 'z.yaml'), 'a: 1')
    writeFileSync(join(dir, 'a.yaml'), 'b: 2')
    writeFileSync(join(dir, 'c.md'), '正文')
    writeFileSync(join(dir, 'd.yml'), 'e: 3')
    mkdirSync(join(dir, 'deep.yaml'))

    expect(listYamlFiles(dir)).toEqual(['a.yaml', 'z.yaml'])
  })
})

describe('paths 布局（v2 书目录钉死）', () => {
  it('各实体路径与计划一致，文件名一律 <id>.<ext>（纯 ASCII 由 id 保证）', () => {
    expect(bookJsonPath('/book')).toBe(join('/book', 'book.json'))
    expect(chapterFile('/book', 'id-1')).toBe(join('/book', 'chapters', 'id-1.md'))
    expect(volumeFile('/book', 'id-2')).toBe(join('/book', 'volumes', 'id-2.yaml'))
    expect(characterFile('/book', 'id-3')).toBe(join('/book', 'characters', 'id-3.yaml'))
    expect(worldEntryFile('/book', 'location', 'id-4')).toBe(
      join('/book', 'world', 'location', 'id-4.yaml')
    )
    expect(foreshadowFile('/book')).toBe(join('/book', 'foreshadow.yaml'))
    expect(backupRoot('/book')).toBe(join('/book', '.migration-backup'))
  })

  it('categorySlug 恒等（枚举已是英文）', () => {
    expect(categorySlug('location')).toBe('location')
    expect(categorySlug('magic')).toBe('magic')
  })

  it('backupStamp 产出 .migration-backup/<ts> 且 ts 冒号已消毒（Windows 文件名禁 :）', () => {
    const stamp = backupStamp('2026-10-26T12:34:56.789Z')

    expect(stamp).toBe('.migration-backup/2026-10-26T12-34-56.789Z')
    expect(stamp).not.toContain(':')
  })
})
