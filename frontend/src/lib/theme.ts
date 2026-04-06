export const colors = {
  primary: {
    DEFAULT: '#4F46E5', 50: '#EEF2FF', 100: '#E0E7FF', 200: '#C7D2FE',
    300: '#A5B4FC', 400: '#818CF8', 500: '#6366F1', 600: '#4F46E5',
    700: '#4338CA', 800: '#3730A3', 900: '#312E81',
  },
  slate: {
    50: '#F8FAFC', 100: '#F1F5F9', 200: '#E2E8F0', 300: '#CBD5E1',
    400: '#94A3B8', 500: '#64748B', 600: '#475569', 700: '#334155',
    800: '#1E293B', 900: '#0F172A',
  },
  success: { light: '#D1FAE5', DEFAULT: '#059669', dark: '#047857' },
  warning: { light: '#FEF3C7', DEFAULT: '#D97706', dark: '#B45309' },
  danger:  { light: '#FEE2E2', DEFAULT: '#DC2626', dark: '#B91C1C' },
  event: {
    meeting:   '#3B82F6',
    personal:  '#8B5CF6',
    reminder:  '#F59E0B',
    task_block:'#10B981',
    google:    '#94A3B8',
  },
} as const

export const priority = {
  urgent: { bg: '#FEE2E2', text: '#DC2626' },
  high:   { bg: '#FEF3C7', text: '#D97706' },
  medium: { bg: '#F1F5F9', text: '#475569' },
  low:    { bg: 'transparent', text: '#94A3B8' },
} as const

export const taskStatus = {
  todo:        { bg: '#F1F5F9', text: '#475569', label: 'To Do' },
  in_progress: { bg: '#EEF2FF', text: '#4F46E5', label: 'In Progress' },
  done:        { bg: '#D1FAE5', text: '#059669', label: 'Done' },
  cancelled:   { bg: 'transparent', text: '#94A3B8', label: 'Cancelled' },
} as const

export const goalStatus = {
  active:    { bg: '#D1FAE5', text: '#059669', label: 'Active' },
  paused:    { bg: '#FEF3C7', text: '#D97706', label: 'Paused' },
  completed: { bg: '#D1FAE5', text: '#059669', label: 'Completed' },
  archived:  { bg: 'transparent', text: '#94A3B8', label: 'Archived' },
} as const

// For Recharts and chart libraries — use in order
export const chartPalette = [
  '#4F46E5', // primary
  '#10B981', // emerald
  '#3B82F6', // blue
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#DC2626', // red
] as const
