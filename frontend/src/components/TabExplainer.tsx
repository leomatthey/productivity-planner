import { useState, useEffect, useCallback } from 'react'
import { HelpCircle, X, type LucideIcon } from 'lucide-react'

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Per-tab explainer modal
//   - Auto-opens once per browser session via sessionStorage flag.
//   - "Got it" closes + sets the flag.
//   - <ExplainerButton /> in the TopBar lets the user reopen it any time.
// ---------------------------------------------------------------------------

export interface ExplainerHighlight {
  icon: LucideIcon
  title: string
  body: string
}

export interface TabExplainerProps {
  /** Stable per-tab key (e.g. "explainer-tasks"). */
  storageKey: string
  /** Modal title (e.g. "Tasks"). */
  title: string
  /** One-line subtitle / lede. */
  subtitle: string
  /** 3-4 bullets, each with an icon + short title + body. */
  highlights: ExplainerHighlight[]
  /** Optional final tip in italics. */
  tip?: string
}

function shouldShowOnMount(storageKey: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(storageKey) !== 'shown'
  } catch {
    return false
  }
}

function markShown(storageKey: string): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(storageKey, 'shown') } catch { /* private mode */ }
}

/**
 * Mount inside a page; opens once per session.
 * Pair with <ExplainerButton onClick={() => setOpen(true)} /> in the TopBar
 * via the manualController prop pattern (see TabExplainerController below).
 */
export function TabExplainer({ storageKey, title, subtitle, highlights, tip }: TabExplainerProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (shouldShowOnMount(storageKey)) {
      // Tiny delay so the page paints first — feels less abrupt.
      const t = setTimeout(() => setOpen(true), 300)
      return () => clearTimeout(t)
    }
  }, [storageKey])

  const close = useCallback(() => {
    setOpen(false)
    markShown(storageKey)
  }, [storageKey])

  return <ExplainerDialog open={open} onClose={close} title={title} subtitle={subtitle} highlights={highlights} tip={tip} />
}

/**
 * Stateful pair: the explainer modal + a TopBar button to reopen it.
 * Returns { dialog, button } so you can drop the button into the AppShell action slot.
 */
export function useTabExplainer(props: TabExplainerProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (shouldShowOnMount(props.storageKey)) {
      const t = setTimeout(() => setOpen(true), 300)
      return () => clearTimeout(t)
    }
  }, [props.storageKey])

  const close = useCallback(() => {
    setOpen(false)
    markShown(props.storageKey)
  }, [props.storageKey])

  const dialog = (
    <ExplainerDialog
      open={open}
      onClose={close}
      title={props.title}
      subtitle={props.subtitle}
      highlights={props.highlights}
      tip={props.tip}
    />
  )

  const button = (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setOpen(true)}
      className="h-8 w-8 p-0 text-slate-400 hover:text-primary"
      title="Show tab guide"
      aria-label="Show tab guide"
    >
      <HelpCircle size={16} />
    </Button>
  )

  return { dialog, button, open, setOpen }
}

interface ExplainerDialogProps extends Omit<TabExplainerProps, 'storageKey'> {
  open: boolean
  onClose: () => void
}

function ExplainerDialog({ open, onClose, title, subtitle, highlights, tip }: ExplainerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        {/* Gradient header strip */}
        <div className="bg-gradient-to-br from-primary-50 via-white to-primary-50/40 border-b border-slate-200 px-6 pt-6 pb-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight">{title}</DialogTitle>
            <DialogDescription className="text-sm text-slate-600 mt-1 leading-relaxed">
              {subtitle}
            </DialogDescription>
          </DialogHeader>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md p-1 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Highlights */}
        <div className="px-6 py-5 space-y-4">
          {highlights.map((h, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="shrink-0 w-8 h-8 rounded-md bg-primary-50 flex items-center justify-center mt-0.5">
                <h.icon size={15} className="text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">{h.title}</p>
                <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{h.body}</p>
              </div>
            </div>
          ))}
          {tip && (
            <p className="text-xs italic text-slate-500 pt-1 pl-11">{tip}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            This guide opens once per session. Click the <HelpCircle size={11} className="inline" /> icon to reopen.
          </span>
          <Button size="sm" onClick={onClose} className="bg-primary text-white hover:bg-primary-700">
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
