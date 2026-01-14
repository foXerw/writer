import React, { useRef, useEffect, useCallback } from 'react'
import Editor, { OnMount, OnChange } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

interface MonacoEditorProps {
  value: string
  language?: string
  theme?: 'vs-dark' | 'vs-light' | 'novel-dark'
  onChange?: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
  wordCount?: boolean
}

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

function MonacoEditor({
  value,
  language = 'markdown',
  theme = 'novel-dark',
  onChange,
  onSave,
  readOnly = false,
  wordCount = true
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)

  // 编辑器挂载
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // 注册写作主题
    monaco.editor.defineTheme('novel-dark', novelDarkTheme)
    monaco.editor.setTheme('theme' in novelDarkTheme ? 'novel-dark' : 'vs-dark')

    // 配置编辑器选项适合写作
    editor.updateOptions({
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
      }
    })

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

    // 初始字数统计
    updateWordCount(editor.getValue())
  }, [onSave])

  // 监听内容变化
  const handleChange: OnChange = useCallback((newValue) => {
    onChange?.(newValue || '')
    if (editorRef.current) {
      updateWordCount(newValue || '')
    }
  }, [onChange])

  // 更新字数统计
  const updateWordCount = (text: string) => {
    const wordCountEl = document.getElementById('editor-word-count')
    if (wordCountEl) {
      const words = text.trim().split(/\s+/).filter(Boolean).length
      const chars = text.length
      wordCountEl.textContent = `字数: ${chars} | 词数: ${words}`
    }
  }

  // 监听值变化
  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.getValue()) {
      // 只在初始化或外部强制更新时设置值
      // 避免编辑时循环更新
    }
  }, [value])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Editor
        height="calc(100% - 24px)"
        language={language}
        value={value}
        theme="novel-dark"
        onChange={handleChange}
        onMount={handleEditorMount}
        options={{
          readOnly,
          automaticLayout: true
        }}
        loading={
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#888'
          }}>
            加载编辑器...
          </div>
        }
      />
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
