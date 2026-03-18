import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { Send, Plus, ChevronDown, ChevronRight, Bot, User, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ai } from '../lib/api'
import type { SessionRecord } from '../lib/api'

// ---------------------------------------------------------------------------
// Session ID helpers
// ---------------------------------------------------------------------------

function newSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
// Tool-use collapsible block
// ---------------------------------------------------------------------------
function ToolBlock({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="msg-tool my-1" onClick={() => setOpen(!open)}>
      <div className="flex items-center gap-1.5">
        <Wrench size={11} />
        <span className="font-medium">{name}</span>
        {open ? <ChevronDown size={11} className="ml-auto" /> : <ChevronRight size={11} className="ml-auto" />}
      </div>
      {open && (
        <pre className="mt-1.5 text-xs overflow-x-auto whitespace-pre-wrap break-words max-h-40">
          {content}
        </pre>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------
function MessageBubble({ msg }: { msg: DisplayMessage }) {
  if (msg.role === 'tool') {
    return <ToolBlock name={msg.tool_name ?? 'tool'} content={msg.content} />
  }

  if (msg.role === 'user') {
    return (
      <div className="flex items-end gap-2 justify-end">
        <div className="msg-user">
          {msg.content}
        </div>
        <User size={16} className="text-slate-400 shrink-0 mb-1" />
      </div>
    )
  }

  // assistant
  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center mt-0.5">
        <Bot size={13} className="text-white" />
      </div>
      <div className="msg-assistant">
        {msg.isStreaming && !msg.content ? (
          <span className="streaming-cursor" />
        ) : (
          <>
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                code: ({ children }) => <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-xs">{children}</code>,
                pre: ({ children }) => <pre className="font-mono bg-slate-100 p-2 rounded text-xs overflow-x-auto mb-2">{children}</pre>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
            {msg.isStreaming && <span className="streaming-cursor" />}
          </>
        )}
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
  const bottomRef                     = useRef<HTMLDivElement>(null)
  const textareaRef                   = useRef<HTMLTextAreaElement>(null)

  const { data: sessions = [] } = useQuery({
    queryKey: ['ai-sessions'],
    queryFn: ai.sessions,
  })

  // Load session from history
  async function loadSession(sid: string) {
    try {
      const records = await ai.session(sid)
      const all: DisplayMessage[] = records.map(r => ({
        id:       String(r.id),
        role:     r.role as DisplayMessage['role'],
        content:  r.content ?? '',
        tool_name: r.tool_name ?? undefined,
      }))
      setMessages(all)
      setSessionId(sid)
    } catch {
      toast.error('Failed to load session')
    }
  }

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    setInput('')
    const userMsg: DisplayMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text,
    }
    setMessages(prev => [...prev, userMsg])

    // Placeholder assistant message
    const asstId = `a_${Date.now()}`
    setMessages(prev => [...prev, { id: asstId, role: 'assistant', content: '', isStreaming: true }])
    setStreaming(true)

    try {
      const response = await ai.chatStream(text, sessionId)
      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
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
          // Tool-use metadata lines look like: {"type":"tool_use","name":"...","result":"..."}
          if (data.startsWith('{') && data.includes('"type":"tool_use"')) {
            try {
              const parsed = JSON.parse(data) as { type: string; name: string; result?: string }
              if (parsed.type === 'tool_use') {
                const toolMsg: DisplayMessage = {
                  id:       `t_${Date.now()}_${Math.random()}`,
                  role:     'tool',
                  content:  parsed.result ?? '',
                  tool_name: parsed.name,
                }
                setMessages(prev => [...prev, toolMsg])
              }
            } catch { /* not JSON, treat as token */ }
            continue
          }
          accumulated += data
          setMessages(prev =>
            prev.map(m => m.id === asstId ? { ...m, content: accumulated } : m)
          )
        }
      }

      setMessages(prev =>
        prev.map(m => m.id === asstId ? { ...m, isStreaming: false } : m)
      )
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
    <div className="flex h-screen bg-white overflow-hidden">
      {/* Left sidebar — session list */}
      <div className="w-[240px] border-r border-slate-200 flex flex-col bg-slate-50 shrink-0">
        <div className="h-[52px] border-b border-slate-200 flex items-center px-4 gap-2">
          <span className="text-sm font-semibold text-slate-700 flex-1">Conversations</span>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={startNewSession} title="New session">
            <Plus size={14} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {/* Current session (if not in list) */}
          <button
            onClick={startNewSession}
            className={`w-full text-left px-3 py-2 rounded text-sm mb-1 transition-colors
              ${!sessions.find((s: SessionRecord) => s.session_id === sessionId)
                ? 'bg-primary-50 text-primary-700 font-medium'
                : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <div className="truncate">New conversation</div>
          </button>

          {sessions.map((s: SessionRecord) => (
            <button
              key={s.session_id}
              onClick={() => loadSession(s.session_id)}
              className={`w-full text-left px-3 py-2 rounded text-sm mb-0.5 transition-colors
                ${s.session_id === sessionId
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <div className="truncate text-xs">{s.last_message || 'Session'}</div>
              <div className="text-xs text-slate-400 mt-0.5">{formatSessionDate(s.updated_at)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Right — chat */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Top bar (not using AppShell since full-height layout) */}
        <div className="h-[56px] border-b border-slate-200 flex items-center px-8 shrink-0">
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">AI Assistant</h1>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mb-4">
                <Bot size={22} className="text-primary" />
              </div>
              <h2 className="text-slate-700 mb-2">How can I help?</h2>
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

        {/* Input */}
        <div className="border-t border-slate-200 px-6 py-4 shrink-0">
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
  )
}
