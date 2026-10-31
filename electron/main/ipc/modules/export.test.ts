// M6 T2 carry-in（T1 评审确认的既存产品 bug）：export.ts 原先按 /\n{2,}/ 空行分段——
// CRLF 正文的 `\r\n\r\n` 不含连续裸 \n，整章塌成单段（word 单 Paragraph、pdf/epub 单 <p>，
// 段格式全灭）。修复=改用 src/common/reviewTypes 的 paragraphsOf 同一条 CRLF 宽容分段规则。
// 本文件是该模块最小测试接缝（原先无 export.test.ts），只钉分段口径，不触 electron 真行为。
import { describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, unknown>())

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow {},
  ipcMain: {
    handle: (channel: string, listener: unknown): void => {
      handlers.set(channel, listener)
    }
  }
}))

import { markdownToHtml } from './export'

describe('markdownToHtml 空行分段（CRLF 加固回归钉）', () => {
  it('LF 章：空行切多个 <p>（既有行为不回退）', () => {
    expect(markdownToHtml('段甲。\n\n段乙。')).toBe('<p>段甲。</p>\n<p>段乙。</p>')
  })

  it('CRLF 章：段数与 LF 同（旧 /\n{2,}/ 会把整章塌成 1 个 <p>）', () => {
    const html = markdownToHtml('段甲。\r\n\r\n段乙。\r\n\r\n段丙。')
    expect((html.match(/<p>/g) ?? []).length).toBe(3)
    expect(html).toContain('<p>段乙。</p>')
  })

  it('段内单换行不裂段：折成 <br/>（LF/CRLF 同权）', () => {
    const html = markdownToHtml('甲\r\n乙。\n\n丙。')
    expect((html.match(/<p>/g) ?? []).length).toBe(2)
    expect(html).toContain('<br/>')
  })

  it('裸 \r 换行单元也参与分段（(?:\\r\\n|\\r|\\n){2,} 口径与 relocateAnchor 一致）', () => {
    const html = markdownToHtml('段甲。\r\r段乙。')
    expect((html.match(/<p>/g) ?? []).length).toBe(2)
  })

  it('子标题识别与首行标题剥离不受换行符影响（无 drive-by 改写）', () => {
    expect(markdownToHtml('# 章题\n\n## 小节\r\n\r\n正文。')).toBe('<h2>小节</h2>\n<p>正文。</p>')
  })

  it('前后导空段过滤，不产空 <p>', () => {
    expect(markdownToHtml('\r\n\r\n只有一段。\r\n\r\n')).toBe('<p>只有一段。</p>')
  })
})
