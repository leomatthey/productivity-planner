import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, Plus, ChevronLeft, ChevronRight, Bot, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sidebar } from '../components/layout/Sidebar'
import { ai } from '../lib/api'
import type { SessionRecord } from '../lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_name?: string
  isStreaming?: boolean
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center">
        <Bot size={13} className="text-white" />
      </div>
      <div className="flex items-center gap-1 px-3 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  // Hide tool messages and assistant tool-call records (JSON blobs)
  if (msg.role === 'tool') return null
  if (msg.role === 'assistant' && msg.tool_name) return null

  if (msg.role === 'user') {
    return (
      <div className="flex items-end gap-2 justify-end">
        <div className="max-w-[78%] bg-primary-600 text-white rounded-xl rounded-br-sm px-3.5 py-2.5 text-sm leading-relaxed">
          {msg.content}
        </div>
        <User size={16} className="text-slate-400 dark:text-slate-500 shrink-0 mb-1" />
      </div>
    )
  }

  // assistant — show thinking indicator while waiting for first token
  if (msg.isStreaming && !msg.content) {
    return <ThinkingIndicator />
  }

  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center mt-0.5">
        <Bot size={13} className="text-white" />
      </div>
      <div className="max-w-[85%] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs rounded-xl rounded-tl-sm px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-200 min-w-0">
        <>
          {/*
            key changes when streaming ends → forces ReactMarkdown to remount with
            the complete content, fixing the "raw markdown after streaming" issue.
          */}
          <ReactMarkdown
              key={msg.isStreaming ? `s-${msg.id}` : `d-${msg.id}`}
              remarkPlugins={[remarkGfm]}
              components={{
                p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul:     ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                ol:     ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                li:     ({ children }) => <li>{children}</li>,
                code:   ({ children }) => (
                  <code className="font-mono bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded text-xs">
                    {children}
                  </code>
                ),
                pre:    ({ children }) => (
                  <pre className="font-mono bg-slate-100 dark:bg-slate-700 p-2 rounded text-xs overflow-x-auto mb-2">
                    {children}
                  </pre>
                ),
                table:  ({ children }) => (
                  <div className="overflow-x-auto mb-2">
                    <table className="w-full text-xs border-collapse">{children}</table>
                  </div>
                ),
                th:     ({ children }) => (
                  <th className="border border-slate-300 dark:border-slate-600 px-2 py-1 bg-slate-100 dark:bg-slate-700 font-semibold text-left">
                    {children}
                  </th>
                ),
                td:     ({ children }) => (
                  <td className="border border-slate-300 dark:border-slate-600 px-2 py-1">
                    {children}
                  </td>
                ),
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em:     ({ children }) => <em className="italic">{children}</em>,
                h1:     ({ children }) => <h1 className="text-base font-bold mb-1 mt-2 text-slate-900 dark:text-slate-100">{children}</h1>,
                h2:     ({ children }) => <h2 className="text-sm font-bold mb-1 mt-2 text-slate-900 dark:text-slate-100">{children}</h2>,
                h3:     ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-1 text-slate-800 dark:text-slate-200">{children}</h3>,
                hr:     () => <hr className="border-slate-200 dark:border-slate-700 my-2" />,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-slate-300 dark:border-slate-600 pl-3 italic text-slate-600 dark:text-slate-400 mb-2">
                    {children}
                  </blockquote>
                ),
              }}
            >
              {msg.content}
            </ReactMarkdown>
          {msg.isStreaming && <span className="streaming-cursor" />}
        </>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AIAssistant() {
  const qc = useQueryClient()
  const [sessionId, setSessionId]     = useState(() => newSessionId())
  const [messages, setMessages]       = useState<DisplayMessage[]>([])
  const [input, setInput]             = useState('')
  const [streaming, setStreaming]     = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const bottomRef                     = useRef<HTMLDivElement>(null)
  const textareaRef                   = useRef<HTMLTextAreaElement>(null)

  const { data: sessions = [] } = useQuery({
    queryKey: ['ai-sessions'],
    queryFn: ai.sessions,
  })

  async function loadSession(sid: string) {
    try {
      const records = await ai.session(sid)
      const all: DisplayMessage[] = records.map(r => ({
        id:        String(r.id),
        role:      r.role as DisplayMessage['role'],
        content:   r.content ?? '',
        tool_name: r.tool_name ?? undefined,
      }))
      setMessages(all)
      setSessionId(sid)
    } catch {
      toast.error('Failed to load session')
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
      const response = await ai.chatStream(text, sessionId)
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
          // Skip tool-use metadata entirely — don't display it
          if (data.startsWith('{') && data.includes('"type":"tool_use"')) continue

          accumulated += data
          setMessages(prev =>
            prev.map(m => m.id === asstId ? { ...m, content: accumulated } : m)
          )
        }
      }

      // Reload session from DB — the DB has the full response_text with newlines
      // intact, whereas the SSE stream strips newlines (word-by-word split).
      // This replaces the newline-stripped accumulated text with the real content.
      try {
        const records = await ai.session(sessionId)
        const allMsgs: DisplayMessage[] = records.map(r => ({
          id:        String(r.id),
          role:      r.role as DisplayMessage['role'],
          content:   r.content ?? '',
          tool_name: r.tool_name ?? undefined,
        }))
        setMessages(allMsgs)
      } catch {
        // Fallback: just mark streaming done with what we have
        setMessages(prev =>
          prev.map(m => m.id === asstId ? { ...m, isStreaming: false } : m)
        )
      }
      qc.invalidateQueries({ queryKey: ['ai-sessions'] })
    } catch {
      toast.error('Failed to send message')
      setMessages(prev => prev.filter(m => m.id !== asstId))
    } finally {
      setStreaming(false)
    }
  }, [input, streaming, sessionId, qc])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function startNewSession() {
    setSessionId(newSessionId())
    setMessages([])
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      {/* Navigation sidebar — same as all other pages */}
      <Sidebar />

      {/* Main area offset by sidebar width */}
      <div className="ml-[240px] flex flex-1 overflow-hidden min-w-0">

        {/* History sidebar — collapsible left panel (Calendar pattern) */}
        <aside className={`flex flex-col shrink-0 bg-slate-50 dark:bg-slate-800 transition-[width] duration-200
          ${sidebarOpen
            ? 'w-[220px] border-r border-slate-200 dark:border-slate-700'
            : 'w-0 overflow-hidden'}`}
        >
          {/* Header row with hide button */}
          <div className="h-10 flex items-center justify-between px-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Conversations
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Hide sidebar"
            >
              <ChevronLeft size={13} />
              <span>Hide</span>
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto p-2">
            {/* "New conversation" always at top */}
            <button
              onClick={startNewSession}
              className={`w-full text-left px-3 py-2 rounded text-sm mb-1 transition-colors
                ${!sessions.find((s: SessionRecord) => s.session_id === sessionId)
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
            >
              <div className="flex items-center gap-1.5">
                <Plus size={12} />
                <span className="truncate text-xs">New conversation</span>
              </div>
            </button>

            {sessions.map((s: SessionRecord) => (
              <button
                key={s.session_id}
                onClick={() => loadSession(s.session_id)}
                className={`w-full text-left px-3 py-2 rounded mb-0.5 transition-colors
                  ${s.session_id === sessionId
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
              >
                <div className="truncate text-xs font-medium">{s.last_message || 'Session'}</div>
                <div className="text-xs text-slate-400 mt-0.5">{formatSessionDate(s.updated_at)}</div>
              </button>
            ))}
          </div>
        </aside>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">

          {/* Top bar */}
          <header className="h-[56px] bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-2">
              {/* Show sidebar button when collapsed (Calendar pattern) */}
              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 px-2 h-8 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors mr-1"
                  title="Show conversations"
                >
                  <ChevronRight size={13} />
                  Conversations
                </button>
              )}
              <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                AI Assistant
              </h1>
            </div>
            <Button size="sm" variant="outline" onClick={startNewSession} className="h-8 text-xs">
              <Plus size={13} className="mr-1" />
              New Chat
            </Button>
          </header>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {messages.filter(m => m.role !== 'tool' && !(m.role === 'assistant' && m.tool_name)).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-12 h-12 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center mb-4">
                  <Bot size={22} className="text-primary-600" />
                </div>
                <h2 className="text-slate-700 dark:text-slate-300 mb-2">How can I help?</h2>
                <p className="text-sm text-slate-400 max-w-xs">
                  Ask me to create tasks, schedule events, analyse your goals, or anything about your productivity.
                </p>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-3 flex flex-col">
                {messages.map(msg => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-slate-200 dark:border-slate-700 px-6 py-4 shrink-0 bg-white dark:bg-slate-900">
            <div className="max-w-2xl mx-auto flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message… (Enter to send, Shift+Enter for newline)"
                rows={1}
                disabled={streaming}
                className="resize-none min-h-[40px] max-h-[120px] overflow-y-auto"
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                size="sm"
                className="h-10 w-10 p-0 shrink-0"
              >
                <Send size={15} />
              </Button>
            </div>
            {streaming && (
              <p className="text-xs text-slate-400 text-center mt-2">AI is thinking…</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
