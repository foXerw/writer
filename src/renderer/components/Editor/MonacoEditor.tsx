import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import type { editor } from 'monaco-editor'
import { useSettingsStore } from '../../stores'
import { countWords } from '@/common/wordCount'

// 动态导入 Monaco（避免 SSR 问题）
let monaco: typeof import('monaco-editor') | null = null

// 正文排印字体：思源宋体族优先（macOS Songti SC / Windows SimSun 兜底，西文 Georgia）
const SERIF_FONT_FAMILY = "'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',Georgia,serif"

// 行高随字号派生：1.9 倍留白，正文才有纸面呼吸感
function createLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.9)
}

// 写作主题配置
const novelDarkTheme = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d4d4' },
    // 兜底：取消 monospace 主题对文本 token 的粗体倾向，正文回到字重正常的宋体
    { token: 'text', fontStyle: 'normal' },
    { token: 'heading', foreground: '569cd6', fontStyle: 'bold' },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'keyword', foreground: 'c586c0' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'comment', foreground: '6a9955' }
  ],
  colors: {
    // editor.background 对齐 global.css --color-paper（dark #1f1e1c）
    'editor.background': '#1f1e1c',
    'editor.foreground': '#d4d4d4',
    // 暖纸底上的行高亮/选区改暖中性，保证与正文仍可区分
    'editor.lineHighlightBackground': '#282723',
    'editor.selectionBackground': '#3a4a5e',
    'editorCursor.foreground': '#e6e2d6',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#c6c6c6',
    'editor.inactiveSelectionBackground': '#3a3d41',
    'editorIndentGuide.background': '#404040',
    'editorIndentGuide.activeBackground': '#707070',
    // 编辑器滚动条配色对齐 global.css 的 ::-webkit-scrollbar token（dark 档）：
    // Monaco 的 slider 颜色走 CSS 变量（--vscode-scrollbarSlider-*），只能经主题色注入——
    // 用样式表硬覆盖会撞上内联/变量层，被迫用强制声明（项目门禁禁止）
    'scrollbar.background': '#00000000',
    // slider 三档镜像 global.css webkit 滚动条 token（dark 档），monaco 只吃字面量色值——
    // 注释钉死对应关系，改 token 时同步这里，防两套观感漂移：
    'scrollbarSlider.background': '#424242',        // ↔ --color-scrollbar-thumb
    'scrollbarSlider.hoverBackground': '#6e6e6e',   // ↔ ::-webkit-scrollbar-thumb:hover 的 --color-text-tertiary
    'scrollbarSlider.activeBackground': '#8a8a8a'   // hover 档再亮一级（webkit 无 active 档，取同向梯度）
  }
}

const novelLightTheme = {
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: '', foreground: '141414' },
    { token: 'text', fontStyle: 'normal' },
    { token: 'heading', foreground: '1677ff', fontStyle: 'bold' },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'keyword', foreground: 'c41d7f' },
    { token: 'string', foreground: '389e0d' },
    { token: 'comment', foreground: '8c8c8c' },
  ],
  colors: {
    // editor.background 对齐 global.css --color-paper（light #faf8f2）
    'editor.background': '#faf8f2',
    'editor.foreground': '#141414',
    // 纸底偏暖，高亮/选区同步微调避免灰白脱节
    'editor.lineHighlightBackground': '#f2eee3',
    'editor.selectionBackground': '#d6e4f0',
    'editorCursor.foreground': '#1677ff',
    'editorLineNumber.foreground': 'bfbfbf',
    'editorLineNumber.activeForeground': '595959',
    'editor.inactiveSelectionBackground': '#e6f4ff',
    'editorIndentGuide.background': '#f0f0f0',
    'editorIndentGuide.activeBackground': '#d9d9d9',
    // 编辑器滚动条配色对齐 global.css 的 ::-webkit-scrollbar token（light 档），同 dark 主题注释
    'scrollbar.background': '#00000000',
    'scrollbarSlider.background': '#c1c1c1',
    'scrollbarSlider.hoverBackground': '#8c8c8c',
    'scrollbarSlider.activeBackground': '#757575'
  },
}

interface MonacoEditorProps {
  value: string
  language?: string
  theme?: 'vs-dark' | 'vs-light' | 'novel-dark'
  onChange?: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
  wordCount?: boolean
  focusMode?: boolean
  typewriterMode?: boolean
  fontSize?: number
  wordWrap?: boolean
  showLineNumbers?: boolean
  /** 可编辑排印列最大宽度（px），正文在此列内居中 */
  maxWidthPx?: number
}

export interface MonacoEditorHandle {
  revealLineInCenter: (lineNumber: number) => void
  /** 视图态快照（光标/滚动/选区，monaco saveViewState 原样透传；编辑器未就绪 → null）。 */
  saveViewState: () => unknown | null
  /**
   * 恢复视图态。monaco 是异步动态导入创建——组件刚挂载、编辑器尚未就绪时暂存到 pendingRef，
   * 创建完成即应用（同一提交内不丢光标；跨视图切换的恢复语义见 Workspace 裁定 3）。
   */
  restoreViewState: (viewState: unknown) => void
}

// Monaco Editor 容器组件
const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(function MonacoEditor({
  value,
  language = 'markdown',
  onChange,
  onSave,
  readOnly = false,
  wordCount = true,
  focusMode = false,
  typewriterMode = false,
  fontSize = 16,
  wordWrap = true,
  showLineNumbers = false,
  maxWidthPx = 760
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  // 未就绪期的恢复暂存（restoreViewState 的异步补丁通道；应用一次即清）
  const pendingViewStateRef = useRef<editor.ICodeEditorViewState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // 底部状态条字数（countWords 口径），从初始 value 起算，编辑/切章时更新
  const [currentWordCount, setCurrentWordCount] = useState(() => countWords(value))
  const themeMode = useSettingsStore((s) => s.themeMode)

  useImperativeHandle(ref, () => ({
    revealLineInCenter: (lineNumber: number) => {
      editorRef.current?.revealLineInCenter(lineNumber)
    },
    saveViewState: () => editorRef.current?.saveViewState() ?? null,
    restoreViewState: (viewState: unknown) => {
      const vs = viewState as editor.ICodeEditorViewState
      if (editorRef.current) editorRef.current.restoreViewState(vs)
      else pendingViewStateRef.current = vs
    }
  }), [])

  // 打字机模式：保持光标在屏幕中央
  const centerCursorInTypewriterMode = useCallback(() => {
    if (!editorRef.current) return
    const position = editorRef.current.getPosition()
    if (!position) return
    editorRef.current.revealLineInCenter(position.lineNumber)
  }, [])

  // 监听光标位置变化（打字机模式）
  useEffect(() => {
    if (!editorRef.current || !monaco) return

    const editor = editorRef.current

    if (typewriterMode) {
      // 首次居中
      centerCursorInTypewriterMode()

      // 监听光标位置变化
      const disposable = editor.onDidChangeCursorPosition(() => {
        centerCursorInTypewriterMode()
      })

      return () => {
        disposable.dispose()
      }
    }
  }, [typewriterMode, centerCursorInTypewriterMode])

  useEffect(() => {
    let mounted = true

    const initMonaco = async () => {
      try {
        // 动态导入 Monaco
        monaco = await import('monaco-editor')

        if (!mounted || !containerRef.current) return

        // 注册写作主题
        monaco.editor.defineTheme('novel-dark', novelDarkTheme)
        monaco.editor.defineTheme('novel-light', novelLightTheme)

        // 创建编辑器
        const editor = monaco.editor.create(containerRef.current, {
          value,
          language,
          theme: themeMode === 'light' ? 'novel-light' : 'novel-dark',
          fontSize,
          fontFamily: SERIF_FONT_FAMILY,
          lineHeight: createLineHeight(fontSize),
          wordWrap: wordWrap ? 'on' : 'off',
          minimap: { enabled: false },
          lineNumbers: showLineNumbers ? 'on' : 'off',
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          cursorStyle: 'line',
          cursorBlinking: typewriterMode ? 'solid' : 'smooth',
          cursorSmoothCaretAnimation: typewriterMode ? 'off' : 'on',
          smoothScrolling: !typewriterMode,
          contextmenu: !focusMode,
          bracketPairColorization: { enabled: false },
          guides: {
            bracketPairs: false,
            indentation: false
          },
          renderWhitespace: 'none',
          // unicode 高亮口径（UI 验收批次 #3 / R1-I1 → 结转微批 #4 收窄为以下两键）：
          // - nonBasicASCII + ambiguousCharacters = 中文正文全角字符误报（黄框被当成异常光标），
          //   关；黄框 artifact 由这两档全局消除，与 token 作用域开关无关。
          // - invisibleCharacters 保持默认开启：零宽空格/控制符是粘贴进稿件的真实隐患，
          //   与普通全角标点不相交——这一档要留。
          // - includeComments/includeStrings 两键已删（核对 monaco 0.55.1 源码
          //   unicodeHighlighter.js：getDecoration(!includeComments, !includeStrings) 会把注释/
          //   字符串 token 作用域豁免**全部**档位的告警、含 invisibleCharacters——旧 false 曾让
          //   markdown 的 ```/~~~ 围栏、四空格代码块、链接目标等 string 作用域成零宽字符盲区）。
          //   删键后 includeStrings 恢复默认 true，字符串盲区闭合；注意 includeComments 的默认值
          //   是 inUntrustedWorkspace 哨兵、standalone 恒 trusted 下解析为 false（HTML 注释/
          //   引用标记等注释作用域仍豁免），彻底闭合需显式 includeComments: true，另行裁定。
          unicodeHighlight: {
            nonBasicASCII: false,
            ambiguousCharacters: false
          },
          // 滚动条对齐应用观感（UI 验收批次 #4）：悬停/滚动才出现、更细、无阴影箭头
          scrollbar: {
            vertical: 'auto',
            horizontal: 'hidden',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 0,
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false
          },
          readOnly
        })

        editorRef.current = editor

        // 跨视图切换的延迟恢复：挂载完成前 restoreViewState 暂存的视图态，创建即应用（一次即清）
        if (pendingViewStateRef.current) {
          editor.restoreViewState(pendingViewStateRef.current)
          pendingViewStateRef.current = null
        }

        // 快捷键：保存
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          onSave?.()
        })

        // 快捷键：粗体
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyB, () => {
          const model = editor.getModel()
          if (model) {
            const selection = editor.getSelection()
            if (selection && !selection.isEmpty()) {
              const selectedText = model.getValueInRange(selection)
              editor.executeEdits('', [{
                range: selection,
                text: `**${selectedText}**`,
                forceMoveMarkers: true
              }])
            }
          }
        })

        // 快捷键：斜体
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI, () => {
          const model = editor.getModel()
          if (model) {
            const selection = editor.getSelection()
            if (selection && !selection.isEmpty()) {
              const selectedText = model.getValueInRange(selection)
              editor.executeEdits('', [{
                range: selection,
                text: `*${selectedText}*`,
                forceMoveMarkers: true
              }])
            }
          }
        })

        // 监听内容变化
        editor.onDidChangeModelContent(() => {
          const newValue = editor.getValue()
          onChange?.(newValue)
          setCurrentWordCount(countWords(newValue))
        })

        setIsLoading(false)
      } catch (error) {
        console.error('Failed to load Monaco:', error)
      }
    }

    initMonaco()

    return () => {
      mounted = false
      if (editorRef.current) {
        editorRef.current.dispose()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 编辑器仅挂载时初始化一次
  }, [])

  // 更新内容
  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.getValue()) {
      editorRef.current.setValue(value)
    }
  }, [value])

  // 更新语言
  useEffect(() => {
    if (editorRef.current && monaco) {
      const model = editorRef.current.getModel()
      if (model) {
        monaco.editor.setModelLanguage(model, language)
      }
    }
  }, [language])

  // 合并的选项更新 effect：readOnly / 专注 / 打字机 / 字号（含派生行高）/ 换行 / 行号
  // 一次 updateOptions 覆盖原先 6 个各自为政的 effect；lineHeight 必须随 fontSize 联动，故同批派生
  useEffect(() => {
    if (!editorRef.current) return
    editorRef.current.updateOptions({
      readOnly,
      contextmenu: !focusMode,
      renderWhitespace: 'none',
      cursorBlinking: typewriterMode ? 'solid' : 'smooth',
      cursorSmoothCaretAnimation: typewriterMode ? 'off' : 'on',
      smoothScrolling: !typewriterMode,
      fontSize,
      lineHeight: createLineHeight(fontSize),
      wordWrap: wordWrap ? 'on' : 'off',
      lineNumbers: showLineNumbers ? 'on' : 'off'
    })
  }, [readOnly, focusMode, typewriterMode, fontSize, wordWrap, showLineNumbers])

  // 跟随全局主题切换编辑器主题
  useEffect(() => {
    if (monaco) {
      monaco.editor.setTheme(themeMode === 'light' ? 'novel-light' : 'novel-dark')
    }
  }, [themeMode])

  return (
    <div className="editor-shell" style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-paper)' }}>
      {/* 排印容器：可编辑列居中、两侧留纸面空白，正文像一页纸 */}
      <div
        ref={containerRef}
        className="editor-print-column"
        // width:100% 必须显式给出：flex column 子项上的 margin:'0 auto'（交叉轴 auto 边距）
        // 会禁用默认 align-items:stretch，宽度退化为 fit-content——而 Monaco 内部 DOM 全部
        // 绝对定位，in-flow 内容为零 → 容器塌缩成几 px（真机 bug：编辑器隐身、无法聚焦输入）。
        // 显式 100% → 按 shell 宽度解析，maxWidth 截断到排印列宽，auto 边距再将其居中。
        style={{ height: '100%', width: '100%', minHeight: 0, flex: 1, maxWidth: maxWidthPx, margin: '0 auto' }}
      />
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-paper)',
          color: 'var(--color-text-secondary)'
        }}>
          加载编辑器...
        </div>
      )}
      {wordCount && (
        <div
          className="editor-status-bar"
          style={{
            height: 24,
            lineHeight: '24px',
            padding: '0 var(--space-4)',
            background: 'var(--color-bg-elevated)',
            borderTop: '1px solid var(--color-border)',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--font-xs)',
            textAlign: 'right',
            letterSpacing: '0.02em',
            flexShrink: 0
          }}
        >
          字数 {currentWordCount.toLocaleString()}
        </div>
      )}
    </div>
  )
})

export default MonacoEditor
