import { useState, useRef, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Send, Plus, Bot, User, Sparkles, ChevronDown, ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { ai } from '../../lib/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_name?: string
  isStreaming?: boolean
}

export interface AIChatPanelProps {
  /** Header label e.g. "Tasks Assistant". */
  contextLabel: string
  /** Stable per-tab session id (e.g. "panel-tasks"); persists conversation. */
  sessionId: string
  /** Up to 4 starter prompts shown on empty state — clicking pre-fills input. */
  starterChips: string[]
  /** Optional one-line intro shown above the chips on the empty state. */
  introTitle?: string
  /**
   * Optional scoping hint sent to the backend.
   * "projects" restricts the agent to task-level operations only.
   */
  panelContext?: 'projects' | 'tasks' | 'habits'
}

// ---------------------------------------------------------------------------
// Bubble + thinking indicator
// ---------------------------------------------------------------------------

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center">
        <Bot size={13} className="text-white" />
      </div>
      <div className="flex items-center gap-1 px-3 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  if (msg.role === 'tool') return null
  if (msg.role === 'assistant' && msg.tool_name) return null

  if (msg.role === 'user') {
    return (
      <div className="flex items-end gap-2 justify-end">
        <div className="max-w-[78%] bg-primary-600 text-white rounded-xl rounded-br-sm px-3 py-2 text-sm leading-relaxed">
          {msg.content}
        </div>
        <User size={14} className="text-slate-400 shrink-0 mb-1" />
      </div>
    )
  }

  if (msg.isStreaming && !msg.content) {
    return <ThinkingIndicator />
  }

  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center mt-0.5">
        <Bot size={13} className="text-white" />
      </div>
      <div className="max-w-[85%] bg-white border border-slate-200 shadow-xs rounded-xl rounded-tl-sm px-3 py-2 text-sm text-slate-800 min-w-0">
        <ReactMarkdown
          key={msg.isStreaming ? `s-${msg.id}` : `d-${msg.id}`}
          remarkPlugins={[remarkGfm]}
          components={{
            p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul:     ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
            ol:     ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
            li:     ({ children }) => <li>{children}</li>,
            code:   ({ children }) => (
              <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-xs">{children}</code>
            ),
            pre:    ({ children }) => (
              <pre className="font-mono bg-slate-100 p-2 rounded text-xs overflow-x-auto mb-2">{children}</pre>
            ),
            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
            em:     ({ children }) => <em className="italic">{children}</em>,
            h1:     ({ children }) => <h1 className="text-base font-bold mb-1 mt-2 text-slate-900">{children}</h1>,
            h2:     ({ children }) => <h2 className="text-sm font-bold mb-1 mt-2 text-slate-900">{children}</h2>,
            h3:     ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-1 text-slate-800">{children}</h3>,
            hr:     () => <hr className="border-slate-200 my-2" />,
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-slate-300 pl-3 italic text-slate-600 mb-2">
                {children}
              </blockquote>
            ),
          }}
        >
          {msg.content}
        </ReactMarkdown>
        {msg.isStreaming && <span className="streaming-cursor" />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline collapsible chat panel
// ---------------------------------------------------------------------------

const PANEL_CHAT_HEIGHT = 480 // px — fixed so the page layout doesn't jump

// localStorage key holding the most recently used session id for a given panel.
// Survives page navigation so "New chat" rotations don't get reset on remount.
const sessionStorageKey = (sessionId: string) => `ai-panel-active:${sessionId}`

function readPersistedSessionId(defaultId: string): string {
  if (typeof window === 'undefined') return defaultId
  try {
    return localStorage.getItem(sessionStorageKey(defaultId)) || defaultId
  } catch {
    return defaultId
  }
}

function writePersistedSessionId(defaultId: string, current: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(sessionStorageKey(defaultId), current) } catch { /* quota / privacy mode */ }
}

export function AIChatPanel({
  contextLabel, sessionId, starterChips, introTitle, panelContext,
}: AIChatPanelProps) {
  const qc = useQueryClient()
  const [expanded, setExpanded]               = useState(false)
  // Initialize from localStorage so rotations survive remounts.
  const [activeSessionId, setActiveSessionId] = useState(() => readPersistedSessionId(sessionId))
  const [messages, setMessages]               = useState<DisplayMessage[]>([])
  const [input, setInput]                     = useState('')
  const [streaming, setStreaming]             = useState(false)

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const textareaRef   = useRef<HTMLTextAreaElement>(null)
  const loadedRef     = useRef<Set<string>>(new Set())

  // If the panel-default sessionId prop changes, re-read persisted id under the new key.
  useEffect(() => {
    setActiveSessionId(readPersistedSessionId(sessionId))
  }, [sessionId])

  // Auto-scroll the INNER chat container only — never affect page scroll.
  // Triggers on message-list changes, NOT on expand toggle.
  useEffect(() => {
    const el = scrollAreaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Restore prior conversation the first time we open this session id
  useEffect(() => {
    if (!expanded) return
    if (loadedRef.current.has(activeSessionId)) return
    loadedRef.current.add(activeSessionId)
    ai.session(activeSessionId)
      .then(records => {
        if (records.length === 0) return
        setMessages(records.map(r => ({
          id:        String(r.id),
          role:      r.role as DisplayMessage['role'],
          content:   r.content ?? '',
          tool_name: r.tool_name ?? undefined,
        })))
      })
      .catch(() => { /* fresh session — ignore */ })
  }, [expanded, activeSessionId])

  // Focus textarea on first expand
  useEffect(() => {
    if (expanded) {
      const t = setTimeout(() => textareaRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [expanded])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    setInput('')
    const userMsg: DisplayMessage = { id: `u_${Date.now()}`, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])

    const asstId = `a_${Date.now()}`
    setMessages(prev => [...prev, { id: asstId, role: 'assistant', content: '', isStreaming: true }])
    setStreaming(true)

    try {
      const response = await ai.chatStream(text, activeSessionId, panelContext)
      if (!response.body) throw new Error('No response body')

      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer      = ''
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue
          if (data.startsWith('[ERROR]')) {
            toast.error('AI error: ' + data.slice(8))
            break
          }
          if (data.startsWith('{') && data.includes('"type":"tool_use"')) continue

          accumulated += data
          setMessages(prev =>
            prev.map(m => m.id === asstId ? { ...m, content: accumulated } : m)
          )
        }
      }

      // Refresh from DB — server has clean newlines that the SSE word-split strips.
      try {
        const records = await ai.session(activeSessionId)
        setMessages(records.map(r => ({
          id:        String(r.id),
          role:      r.role as DisplayMessage['role'],
          content:   r.content ?? '',
          tool_name: r.tool_name ?? undefined,
        })))
      } catch {
        setMessages(prev =>
          prev.map(m => m.id === asstId ? { ...m, isStreaming: false } : m)
        )
      }

      // Underlying page should reflect agent-created rows immediately.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks'] }),
        qc.invalidateQueries({ queryKey: ['goals'] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['habits'] }),
        qc.invalidateQueries({ queryKey: ['events'] }),
        qc.invalidateQueries({ queryKey: ['events-scheduling'] }),
        qc.invalidateQueries({ queryKey: ['analytics-stats'] }),
        qc.invalidateQueries({ queryKey: ['ai-sessions'] }),
      ])
    } catch {
      toast.error('Failed to send message')
      setMessages(prev => prev.filter(m => m.id !== asstId))
    } finally {
      setStreaming(false)
    }
  }, [input, streaming, activeSessionId, panelContext, qc])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function startNewChat(e: React.MouseEvent) {
    e.stopPropagation()
    if (streaming) return
    const fresh = `${sessionId}-${Date.now().toString(36)}`
    writePersistedSessionId(sessionId, fresh)  // survive remounts
    setActiveSessionId(fresh)
    setMessages([])
    setInput('')
    setTimeout(() => textareaRef.current?.focus(), 80)
  }

  function applyChip(prompt: string) {
    setInput(prompt)
    setTimeout(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        const len = prompt.length
        ta.setSelectionRange(len, len)
      }
    }, 50)
  }

  const visible = messages.filter(
    m => m.role !== 'tool' && !(m.role === 'assistant' && m.tool_name),
  )

  return (
    <section className="card overflow-hidden">
      {/* Header — clickable bar that toggles expansion */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={16} className="text-primary shrink-0" />
          <span className="text-sm font-semibold text-slate-900 truncate">{contextLabel}</span>
          {visible.length > 0 && !expanded && (
            <span className="text-xs text-slate-400 ml-1">
              · {visible.length} message{visible.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {expanded && (
            <span
              role="button"
              tabIndex={0}
              onClick={startNewChat}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') startNewChat(e as unknown as React.MouseEvent) }}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                streaming
                  ? 'text-slate-300 cursor-not-allowed'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer'
              }`}
              title="Start a new conversation"
            >
              <Plus size={12} />
              New chat
            </span>
          )}
          {expanded
            ? <ChevronUp   size={16} className="text-slate-400" />
            : <ChevronDown size={16} className="text-slate-400" />
          }
        </div>
      </button>

      {/* Body — only mounted when expanded for cleaner DOM */}
      {expanded && (
        <div className="border-t border-slate-200 flex flex-col">
          {/* Chat scroll area */}
          <div
            ref={scrollAreaRef}
            className="overflow-y-auto px-4 py-3"
            style={{ height: `${PANEL_CHAT_HEIGHT}px` }}
          >
            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center pt-2">
                <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center mb-3">
                  <Bot size={18} className="text-primary-600" />
                </div>
                {introTitle && (
                  <p className="text-sm font-medium text-slate-700 mb-2 px-2">{introTitle}</p>
                )}
                <p className="text-xs text-slate-400 max-w-[320px] mb-4 leading-relaxed">
                  Tap a starter or write your own. The agent creates items live and the page above updates instantly.
                </p>
                <div className="flex flex-col gap-2 w-full max-w-[420px]">
                  {starterChips.map((chip, i) => (
                    <button
                      key={i}
                      onClick={() => applyChip(chip)}
                      className="text-left text-xs px-3 py-2 rounded-md bg-slate-50 hover:bg-primary-50 hover:text-primary-700 border border-slate-200 transition-colors leading-snug"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3 flex flex-col">
                {visible.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 p-3 bg-white">
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask… (Enter to send, Shift+Enter for newline)"
                rows={1}
                disabled={streaming}
                className="resize-none min-h-[36px] max-h-[120px] text-sm"
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                size="sm"
                className="h-9 w-9 p-0 shrink-0"
              >
                <Send size={14} />
              </Button>
            </div>
            {streaming && (
              <p className="text-xs text-slate-400 text-center mt-1.5">AI is thinking…</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
