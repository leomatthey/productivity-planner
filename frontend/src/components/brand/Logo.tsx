interface LogoProps {
  /** Pixel size of the SVG mark (square). */
  size?: number
  /** Optional tailwind classes for the SVG colour (defaults to primary). */
  className?: string
}

/**
 * Stride logo — two stacked forward chevrons suggesting motion.
 * Uses currentColor so it inherits the surrounding text colour.
 */
export function Logo({ size = 22, className = 'text-primary' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Stride"
    >
      <path
        d="M5 6L11 12L5 18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 6L19 12L13 18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
    </svg>
  )
}

interface WordmarkProps {
  /** When true, renders the icon + name horizontally; otherwise just the wordmark. */
  withIcon?: boolean
  /** Tailwind classes for the wordmark text. */
  className?: string
  /** Tailwind classes applied to the icon when withIcon is true. */
  iconClassName?: string
  /** Icon size. */
  iconSize?: number
}

/**
 * Stride wordmark. Pair with <Logo /> via withIcon.
 */
export function Wordmark({
  withIcon = false,
  className = 'text-base font-bold text-slate-900 tracking-tight',
  iconClassName = 'text-primary',
  iconSize = 22,
}: WordmarkProps) {
  if (!withIcon) {
    return <span className={className}>Stride</span>
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Logo size={iconSize} className={iconClassName} />
      <span className={className}>Stride</span>
    </span>
  )
}
