import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enUS } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { Plus, RefreshCw, X, MapPin, Clock } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { calendar } from '../lib/api'
import type { CalendarEvent, EventType } from '../types'

// ---------------------------------------------------------------------------
// react-big-calendar setup with date-fns
// ---------------------------------------------------------------------------

const locales = { 'en-US': enUS }

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
})

// ---------------------------------------------------------------------------
// Event colours
// ---------------------------------------------------------------------------

const EVENT_COLOURS: Record<string, string> = {
  meeting:      '#3B82F6',
  personal:     '#8B5CF6',
  reminder:     '#F59E0B',
  task_block:   '#10B981',
  google_import:'#94A3B8',
}

function eventStyle(event: CalendarEvent) {
  const colour = EVENT_COLOURS[event.event_type] ?? '#94A3B8'
  return {
    style: {
      backgroundColor: colour,
      borderColor: colour,
      borderRadius: '4px',
      color: '#fff',
      fontSize: '12px',
      padding: '2px 6px',
    },
  }
}

// ---------------------------------------------------------------------------
// Convert API event to big-calendar event
// ---------------------------------------------------------------------------

interface BigCalEvent {
  id: number
  title: string
  start: Date
  end: Date
  resource: CalendarEvent
}

function toBigCalEvent(e: CalendarEvent): BigCalEvent {
  return {
    id: e.id,
    title: e.title,
    start: new Date(e.start_datetime),
    end:   new Date(e.end_datetime),
    resource: e,
  }
}

// ---------------------------------------------------------------------------
// Event form dialog
// ---------------------------------------------------------------------------

interface EventFormProps {
  open: boolean
  onClose: () => void
  onSave: (data: Partial<CalendarEvent>, id?: number) => void
  initial?: CalendarEvent | null
  defaultStart?: Date
}

function EventFormDialog({ open, onClose, onSave, initial, defaultStart }: EventFormProps) {
  const toLocal = (iso: string) => iso.slice(0, 16) // YYYY-MM-DDTHH:mm

  const [title, setTitle]         = useState('')
  const [start, setStart]         = useState('')
  const [end, setEnd]             = useState('')
  const [type, setType]           = useState<EventType>('personal')
  const [location, setLocation]   = useState('')
  const [description, setDesc]    = useState('')

  useEffect(() => {
    if (initial) {
      setTitle(initial.title)
      setStart(toLocal(initial.start_datetime))
      setEnd(toLocal(initial.end_datetime))
      setType(initial.event_type as EventType)
      setLocation(initial.location ?? '')
      setDesc(initial.description ?? '')
    } else {
      const base = defaultStart ?? new Date()
      const endDate = new Date(base); endDate.setHours(endDate.getHours() + 1)
      setTitle('')
      setStart(base.toISOString().slice(0, 16))
      setEnd(endDate.toISOString().slice(0, 16))
      setType('personal'); setLocation(''); setDesc('')
    }
  }, [initial, open, defaultStart])

  function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    onSave({
      title,
      start_datetime: new Date(start).toISOString(),
      end_datetime:   new Date(end).toISOString(),
      event_type: type,
      location: location || undefined,
      description: description || undefined,
    }, initial?.id)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Event' : 'New Event'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <Clock size={11} /> Start
              </label>
              <Input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className="mt-1 h-8" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">End</label>
              <Input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className="mt-1 h-8" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Type</label>
            <Select value={type} onValueChange={v => setType(v as EventType)}>
              <SelectTrigger className="mt-1 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="reminder">Reminder</SelectItem>
                <SelectItem value="task_block">Task Block</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
              <MapPin size={11} /> Location
            </label>
            <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Optional" className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Description</label>
            <Textarea value={description} onChange={e => setDesc(e.target.value)} rows={2} className="mt-1" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} className="flex-1">Save</Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Event detail panel
// ---------------------------------------------------------------------------

function EventDetail({ event, onEdit, onDelete, onClose }: {
  event: CalendarEvent
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const colour = EVENT_COLOURS[event.event_type] ?? '#94A3B8'
  return (
    <div className="card-elevated p-4 w-72">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-start gap-2">
          <div className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: colour }} />
          <h3 className="font-semibold text-slate-900">{event.title}</h3>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2 text-sm text-slate-600">
        <div className="flex items-center gap-2">
          <Clock size={13} className="text-slate-400" />
          <span>{new Date(event.start_datetime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
        {event.location && (
          <div className="flex items-center gap-2">
            <MapPin size={13} className="text-slate-400" />
            <span>{event.location}</span>
          </div>
        )}
        {event.description && (
          <p className="text-slate-500 text-xs mt-2">{event.description}</p>
        )}
        <div>
          <span className="badge bg-slate-100 text-slate-600">{event.event_type}</span>
          {event.source === 'google' && <span className="badge bg-slate-100 text-slate-400 ml-1">Google</span>}
        </div>
      </div>

      {!event.is_read_only && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={onEdit} className="flex-1 h-7 text-xs">Edit</Button>
          <Button size="sm" variant="outline" onClick={onDelete} className="h-7 text-xs text-danger border-danger/30 hover:bg-danger-light">
            Delete
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Calendar() {
  const qc = useQueryClient()
  const [view, setView]             = useState<View>('month')
  const [date, setDate]             = useState(new Date())
  const [formOpen, setFormOpen]     = useState(false)
  const [editing, setEditing]       = useState<CalendarEvent | null>(null)
  const [detailEvent, setDetail]    = useState<CalendarEvent | null>(null)
  const [defaultStart, setDefStart] = useState<Date | undefined>()
  const [syncing, setSyncing]       = useState(false)

  // Compute window for current view
  const viewStart = new Date(date.getFullYear(), date.getMonth() - 1, 1)
  const viewEnd   = new Date(date.getFullYear(), date.getMonth() + 2, 0)

  const { data: rawEvents = [], isLoading } = useQuery({
    queryKey: ['events', viewStart.toISOString(), viewEnd.toISOString()],
    queryFn: () => calendar.events({
      start: viewStart.toISOString(),
      end:   viewEnd.toISOString(),
    }),
  })

  const bigCalEvents = rawEvents.map(toBigCalEvent)

  const createEvent = useMutation({
    mutationFn: (body: Parameters<typeof calendar.createEvent>[0]) => calendar.createEvent(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events'] }); toast.success('Event created') },
    onError: () => toast.error('Failed to create event'),
  })

  const updateEvent = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof calendar.updateEvent>[1] }) =>
      calendar.updateEvent(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events'] }); toast.success('Event updated') },
    onError: () => toast.error('Failed to update event'),
  })

  const deleteEvent = useMutation({
    mutationFn: (id: number) => calendar.deleteEvent(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events'] }); toast.success('Event deleted') },
    onError: () => toast.error('Failed to delete event'),
  })

  function handleSave(data: Partial<CalendarEvent>, id?: number) {
    if (id) {
      updateEvent.mutate({ id, data })
    } else {
      createEvent.mutate({
        title:           data.title!,
        start_datetime:  data.start_datetime!,
        end_datetime:    data.end_datetime!,
        event_type:      data.event_type,
        location:        data.location,
        description:     data.description,
      })
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const result = await calendar.sync()
      qc.invalidateQueries({ queryKey: ['events'] })
      toast.success(`Synced ${result.synced} events from Google Calendar`)
    } catch {
      toast.error('Google Calendar sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const action = (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleSync}
        disabled={syncing}
        className="h-8 text-xs"
      >
        <RefreshCw size={13} className={`mr-1 ${syncing ? 'animate-spin' : ''}`} />
        Sync Google
      </Button>
      <Button size="sm" onClick={() => { setEditing(null); setDefStart(new Date()); setFormOpen(true) }}>
        <Plus size={14} className="mr-1" /> New Event
      </Button>
    </div>
  )

  return (
    <AppShell title="Calendar" action={action}>
      {isLoading ? (
        <div className="card h-[600px] animate-pulse" />
      ) : (
        <div className="card p-4">
          <BigCalendar
            localizer={localizer}
            events={bigCalEvents}
            view={view}
            date={date}
            onView={v => setView(v)}
            onNavigate={d => setDate(d)}
            onSelectEvent={e => setDetail(e.resource)}
            onSelectSlot={slotInfo => {
              setEditing(null)
              setDefStart(slotInfo.start)
              setFormOpen(true)
            }}
            selectable
            style={{ height: 600 }}
            eventPropGetter={e => eventStyle(e.resource)}
            views={['month', 'week', 'day']}
            popup
          />
        </div>
      )}

      {/* Floating event detail */}
      {detailEvent && (
        <div className="fixed bottom-6 right-6 z-50 shadow-xl rounded-xl">
          <EventDetail
            event={detailEvent}
            onEdit={() => { setEditing(detailEvent); setFormOpen(true); setDetail(null) }}
            onDelete={() => {
              deleteEvent.mutate(detailEvent.id)
              setDetail(null)
            }}
            onClose={() => setDetail(null)}
          />
        </div>
      )}

      <EventFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSave={handleSave}
        initial={editing}
        defaultStart={defaultStart}
      />
    </AppShell>
  )
}
