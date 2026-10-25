import { describe, it, expect } from 'vitest'
import { countWords } from './wordCount'

describe('countWords 中文正确的字数统计口径', () => {
  it('空串返回 0', () => {
    expect(countWords('')).toBe(0)
  })

  it('纯空白返回 0', () => {
    expect(countWords('   \n\t ')).toBe(0)
  })

  it('每个汉字计 1，中文标点不计', () => {
    expect(countWords('你好，世界')).toBe(4)
  })

  it('拉丁字母连续串计 1，汉字各计 1', () => {
    expect(countWords('Hello world 你好')).toBe(4)
  })

  it('markdown 语法字符（* 等）剥离后不计入', () => {
    expect(countWords('**加粗文本** and more')).toBe(6)
  })

  it('定案：第123章 === 3（汉字各 1，数字连续串计 1）', () => {
    expect(countWords('第123章')).toBe(3)
  })

  it('纯标点（中英文）返回 0', () => {
    expect(countWords('，。！？.,!?;:')).toBe(0)
  })

  it('标题井号剥离后只数正文汉字', () => {
    expect(countWords('# 标题\n\n正文')).toBe(4)
  })

  it('混排章节行：第123章：你好 Hello => 6', () => {
    // 第(1) + 123(1) + 章(1) + 你(1) + 好(1) + Hello(1)；冒号为标点不计
    expect(countWords('第123章：你好 Hello')).toBe(6)
  })

  it('冒号与引号等英文标点不计，数字与字母同串合并计 1', () => {
    expect(countWords('「a1b2」')).toBe(1)
  })
})
