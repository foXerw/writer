import { useRef, useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'

// 动态导入 Monaco（避免 SSR 问题）
let monaco: typeof import('monaco-editor') | null = null

// 写作主题配置
const novelDarkTheme = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d4d4' },
    { token: 'heading', foreground: '569cd6', fontStyle: 'bold' },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'keyword', foreground: 'c586c0' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'comment', foreground: '6a9955' }
  ],
  colors: {
    'editor.background': '#1e1e1e',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#2d2d2d',
    'editor.selectionBackground': '#264f78',
    'editorCursor.foreground': '#aeafad',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#c6c6c6',
    'editor.inactiveSelectionBackground': '#3a3d41',
    'editorIndentGuide.background': '#404040',
    'editorIndentGuide.activeBackground': '#707070'
  }
}

interface MonacoEditorProps {
  value: string
  language?: string
  theme?: 'vs-dark' | 'vs-light' | 'novel-dark'
  onChange?: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
  wordCount?: boolean
}

// Monaco Editor 容器组件
function MonacoEditor({
  value,
  language = 'markdown',
  onChange,
  onSave,
  readOnly = false,
  wordCount = true
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const initMonaco = async () => {
      try {
        // 动态导入 Monaco
        monaco = await import('monaco-editor')

        if (!mounted || !containerRef.current) return

        // 注册写作主题
        monaco.editor.defineTheme('novel-dark', novelDarkTheme)

        // 创建编辑器
        const editor = monaco.editor.create(containerRef.current, {
          value,
          language,
          theme: 'novel-dark',
          fontSize: 16,
          fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
          lineHeight: 28,
          wordWrap: 'on',
          minimap: { enabled: false },
          lineNumbers: 'off',
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          cursorStyle: 'line',
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          contextmenu: true,
          bracketPairColorization: { enabled: false },
          guides: {
            bracketPairs: false,
            indentation: false
          },
          readOnly
        })

        editorRef.current = editor

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
          updateWordCount(newValue)
        })

        // 初始字数统计
        updateWordCount(value)
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

  // 更新只读状态
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ readOnly })
    }
  }, [readOnly])

  // 更新字数统计
  const updateWordCount = (text: string) => {
    const wordCountEl = document.getElementById('editor-word-count')
    if (wordCountEl) {
      const words = text.trim().split(/\s+/).filter(Boolean).length
      const chars = text.length
      wordCountEl.textContent = `字数: ${chars} | 词数: ${words}`
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={containerRef}
        style={{ height: 'calc(100% - 24px)' }}
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
          background: '#1e1e1e',
          color: '#888'
        }}>
          加载编辑器...
        </div>
      )}
      {wordCount && (
        <div
          id="editor-word-count"
          style={{
            height: 24,
            lineHeight: '24px',
            padding: '0 16px',
            background: '#252526',
            borderTop: '1px solid #333',
            color: '#888',
            fontSize: 12,
            textAlign: 'right'
          }}
        >
          字数: 0 | 词数: 0
        </div>
      )}
    </div>
  )
}

export default MonacoEditor
