/**
 * colors.ts — Unified color system for projects and tasks.
 *
 * Rules:
 * 1. Top-level projects pick from PROJECT_COLORS palette
 * 2. Sub-projects inherit parent color as a lighter shade (no picker)
 * 3. Tasks without a project = grey (#E2E8F0)
 * 4. This color propagates everywhere: task dots, kanban, calendar events
 */

import type { Project } from '../types'

// ---------------------------------------------------------------------------
// Palette — 12 colors sorted by hue for visual coherence
// ---------------------------------------------------------------------------

export const PROJECT_COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#F59E0B', // amber
  '#84CC16', // lime
  '#10B981', // emerald
  '#14B8A6', // teal
  '#0EA5E9', // sky
  '#3B82F6', // blue
  '#4F46E5', // indigo
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#F43F5E', // rose
] as const

export const PROJECT_PALETTE = PROJECT_COLORS

/** Grey used for tasks/events with no project */
export const NO_PROJECT_COLOR = '#E2E8F0'

// ---------------------------------------------------------------------------
// HSL utilities
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
// Sub-project shade
// ---------------------------------------------------------------------------

/**
 * Single lighter shade derived from parent color.
 * Same for ALL sub-projects of a parent — no per-sibling variation.
 */
export function getSubProjectShade(parentColor: string): string {
  const { h, s } = hexToHSL(parentColor)
  return hslToHex(h, Math.max(s * 0.8, 30), 60)
}

/** @deprecated Use getSubProjectShade */
export function getSubProjectColor(parentColor: string, _siblingIndex: number): string {
  return getSubProjectShade(parentColor)
}

// ---------------------------------------------------------------------------
// Main color lookup — the ONE function everything uses
// ---------------------------------------------------------------------------

/**
 * Returns the display color for a project.
 * - Top-level with stored color → that color
 * - Top-level without color → palette fallback
 * - Sub-project → lighter shade of parent's color
 * - No project (undefined) → grey
 */
export function getProjectColor(
  projectId: number | undefined,
  projects: Project[],
): string {
  if (projectId === undefined) return NO_PROJECT_COLOR
  const project = projects.find(p => p.id === projectId)
  if (!project) return NO_PROJECT_COLOR

  // If project has an explicit color, use it
  if (project.color) return project.color

  // Sub-project: inherit lighter shade from parent
  if (project.parent_id) {
    const parent = projects.find(p => p.id === project.parent_id)
    const parentColor = parent?.color ?? PROJECT_COLORS[(parent?.id ?? 0) % PROJECT_COLORS.length]
    return getSubProjectShade(parentColor)
  }

  // Top-level without stored color: fallback to palette
  return PROJECT_COLORS[projectId % PROJECT_COLORS.length]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function colorWithOpacity(hex: string, opacity: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export function getContrastColor(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#1E293B' : '#FFFFFF'
}

export function generateShades(hex: string): { light: string; DEFAULT: string; dark: string } {
  const { h, s } = hexToHSL(hex)
  return {
    light:   hslToHex(h, s * 0.4, 94),
    DEFAULT: hex,
    dark:    hslToHex(h, s,        30),
  }
}
