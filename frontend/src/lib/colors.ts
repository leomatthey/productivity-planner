/**
 * colors.ts — Project colour palette + HSL utilities
 * Used by Projects page, Tasks page (project chips), and Calendar (task_block events).
 */

import type { Goal } from '../types'

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const PROJECT_COLORS = [
  '#4F46E5', // indigo   (primary)
  '#0EA5E9', // sky
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo-alt
] as const

// ---------------------------------------------------------------------------
// Colour conversion helpers
// ---------------------------------------------------------------------------

export function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case r: h = ((g - b) / delta + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / delta + 2) / 6; break
      case b: h = ((r - g) / delta + 4) / 6; break
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

export function hslToHex(h: number, s: number, l: number): string {
  const hNorm = h / 360
  const sNorm = s / 100
  const lNorm = l / 100

  const hue2rgb = (p: number, q: number, t: number) => {
    let tNorm = t
    if (tNorm < 0) tNorm += 1
    if (tNorm > 1) tNorm -= 1
    if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm
    if (tNorm < 1 / 2) return q
    if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6
    return p
  }

  let r: number, g: number, b: number
  if (sNorm === 0) {
    r = g = b = lNorm
  } else {
    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm
    const p = 2 * lNorm - q
    r = hue2rgb(p, q, hNorm + 1 / 3)
    g = hue2rgb(p, q, hNorm)
    b = hue2rgb(p, q, hNorm - 1 / 3)
  }

  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// ---------------------------------------------------------------------------
// Shade generation
// ---------------------------------------------------------------------------

/**
 * Returns light (90% L), DEFAULT (original), and dark (30% L) shades of a hex colour.
 */
export function generateShades(hex: string): { light: string; DEFAULT: string; dark: string } {
  const { h, s } = hexToHSL(hex)
  return {
    light:   hslToHex(h, s * 0.4, 94),
    DEFAULT: hex,
    dark:    hslToHex(h, s,        30),
  }
}

/**
 * Returns a color for a sub-project derived from its parent's color.
 * Each sibling index gets a progressively lighter shade with a small hue rotation.
 */
export function getSubProjectColor(parentColor: string, siblingIndex: number): string {
  const { h, s, l } = hexToHSL(parentColor)
  const newL = Math.min(l + 14 + siblingIndex * 10, 78)
  const newS = Math.max(s * 0.72, 28)
  const newH = (h + siblingIndex * 9) % 360
  return hslToHex(newH, newS, newL)
}

// ---------------------------------------------------------------------------
// Project colour lookup
// ---------------------------------------------------------------------------

/**
 * Returns the colour for a project by id. Uses the project's stored color field
 * if present; otherwise falls back to PROJECT_COLORS[id % palette.length].
 */
export function getProjectColor(
  projectId: number | undefined,
  projects: Goal[],
): string {
  if (projectId === undefined) return PROJECT_COLORS[0]
  const project = projects.find(p => p.id === projectId)
  if (project?.color) return project.color
  return PROJECT_COLORS[projectId % PROJECT_COLORS.length]
}

// ---------------------------------------------------------------------------
// Contrast helper
// ---------------------------------------------------------------------------

/**
 * Returns '#FFFFFF' or '#1E293B' depending on which gives better contrast
 * against the given background hex.
 */
export function getContrastColor(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  // Perceived luminance formula (WCAG)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#1E293B' : '#FFFFFF'
}
