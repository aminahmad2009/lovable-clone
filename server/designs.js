/* A curated library of design directions the agent can be steered toward.
 * Each preset contributes a short brief that is injected into the system
 * prompt, plus swatch colors for the picker UI. Purely local — no network. */

export const DESIGN_PRESETS = [
  {
    id: 'minimal-light',
    name: 'Minimal Light',
    description: 'Airy whitespace, neutral grays, hairline borders, one restrained accent. Calm and readable.',
    tags: ['clean', 'minimal', 'saas', 'light'],
    colors: ['#ffffff', '#f4f4f5', '#18181b', '#2563eb'],
    brief: `Design direction: MINIMAL LIGHT.
- Palette: white and near-white surfaces (#ffffff, #f4f4f5, #fafafa), ink text (#18181b), muted gray secondary text (#71717a), a single restrained accent (#2563eb) used sparingly for primary actions and links.
- Borders: 1px hairlines (#e4e4e7). Rounded corners modest (rounded-lg / 8-12px). Shadows very subtle or none.
- Typography: system sans, generous line-height, clear size scale. Lots of whitespace; do not crowd.
- Components: flat, quiet, functional. Prefer outline/ghost buttons; one solid primary button per view.`,
  },
  {
    id: 'modern-dark',
    name: 'Modern Dark',
    description: 'Deep charcoal surfaces, glassy panels, one vivid neon accent. Sleek and technical.',
    tags: ['dark', 'neon', 'dashboard', 'tech'],
    colors: ['#0a0a0f', '#16161d', '#22d3ee', '#a855f7'],
    brief: `Design direction: MODERN DARK.
- Palette: deep charcoal/near-black surfaces (#0a0a0f, #16161d, #1e1e28), light text (#e7e7ea), muted gray (#8b8b99). One vivid accent (cyan #22d3ee) with a secondary violet (#a855f7) for highlights.
- Panels: subtle translucency and thin light-on-dark borders (rgba(255,255,255,0.08)); soft glows on focused/active elements.
- Typography: crisp sans, high contrast. Accent color for key numbers, active nav, primary CTA.
- Mood: sleek, technical, "control room". Keep contrast accessible (never dim text on dim bg).`,
  },
  {
    id: 'bold-marketing',
    name: 'Bold Marketing',
    description: 'Oversized headlines, punchy gradients, high-energy sections built to convert a landing page.',
    tags: ['landing', 'marketing', 'gradient', 'bold'],
    colors: ['#0f172a', '#6366f1', '#ec4899', '#f59e0b'],
    brief: `Design direction: BOLD MARKETING.
- Palette: strong gradient pair (indigo #6366f1 → pink #ec4899) for hero and CTAs, deep navy ink (#0f172a), warm amber accent (#f59e0b).
- Typography: oversized, tight-tracked display headings; large hero type, clear subheads. Strong weight contrast between headline and body.
- Layout: full-bleed hero, feature grids, social-proof strips, prominent CTA buttons with hover lift. Generous section padding.
- Components: pill buttons, gradient text for emphasis, cards with soft shadows. Energetic but aligned and consistent.`,
  },
  {
    id: 'data-dashboard',
    name: 'Data Dashboard',
    description: 'Dense, information-first layout: stat cards, tables, charts, tight spacing, professional.',
    tags: ['analytics', 'dashboard', 'data', 'admin'],
    colors: ['#0b1220', '#1e293b', '#38bdf8', '#34d399'],
    brief: `Design direction: DATA DASHBOARD.
- Palette: slate surfaces (#0b1220 / #1e293b dark, or #f8fafc / #ffffff light), info blue (#38bdf8), positive green (#34d399), warning amber, danger red for status.
- Layout: dense but ordered — a KPI/stat card row up top, then tables and chart panels in a responsive grid. Consistent 8px spacing rhythm.
- Components: stat cards with label + big number + delta, sortable-looking tables with zebra/row-hover, status pills, filter bar. Tabular numerals for figures.
- Typography: compact, legible at small sizes. Prioritize scannability over decoration.`,
  },
  {
    id: 'playful',
    name: 'Playful',
    description: 'Rounded shapes, bright friendly colors, bouncy spacing. Welcoming consumer-app feel.',
    tags: ['friendly', 'colorful', 'rounded', 'consumer'],
    colors: ['#fff7ed', '#fb7185', '#fbbf24', '#34d399'],
    brief: `Design direction: PLAYFUL.
- Palette: warm off-white base (#fff7ed), bright friendly accents — coral (#fb7185), sunny yellow (#fbbf24), mint (#34d399). Multi-accent is welcome but keep one dominant.
- Shapes: very rounded (rounded-2xl/3xl), chunky buttons, soft pillowy shadows.
- Typography: rounded/geometric sans, larger sizes, upbeat. Emoji or simple icons are fine as accents.
- Mood: warm, approachable, fun. Generous padding, gentle motion on hover.`,
  },
  {
    id: 'corporate',
    name: 'Corporate',
    description: 'Conservative blue-gray, structured grid, accessibility-first. Trustworthy enterprise look.',
    tags: ['enterprise', 'professional', 'accessible', 'trust'],
    colors: ['#ffffff', '#f1f5f9', '#1e3a8a', '#0f766e'],
    brief: `Design direction: CORPORATE / ENTERPRISE.
- Palette: white and cool gray surfaces (#ffffff, #f1f5f9), deep blue primary (#1e3a8a), teal secondary (#0f766e), neutral gray text (#334155).
- Layout: structured, predictable grid; clear headers; consistent card and table styling. Nothing gimmicky.
- Accessibility: strong contrast (WCAG AA), visible focus states, sensible hit targets, semantic labels.
- Typography: neutral professional sans, moderate sizes, clear hierarchy. Trust and clarity over flair.`,
  },
  {
    id: 'brutalist',
    name: 'Brutalist',
    description: 'Stark and raw: heavy black borders, monospace type, flat blocks, no gradients or shadows.',
    tags: ['brutalist', 'raw', 'mono', 'bold'],
    colors: ['#ffffff', '#000000', '#facc15', '#22d3ee'],
    brief: `Design direction: BRUTALIST.
- Palette: stark white and pure black, one or two flat high-impact accents (yellow #facc15, cyan #22d3ee). No gradients, no soft shadows.
- Borders: heavy, hard-edged (2-4px solid black). Sharp corners (no rounding) or uniform small radius.
- Typography: monospace or heavy grotesque, uppercase labels, oversized weights, tight or intentionally awkward spacing.
- Layout: raw blocks, visible structure, asymmetric or grid-forward. Deliberate and confident, not sloppy.`,
  },
  {
    id: 'elegant-serif',
    name: 'Elegant Serif',
    description: 'Editorial and refined: serif headings, muted palette, generous margins, premium feel.',
    tags: ['editorial', 'serif', 'luxury', 'elegant'],
    colors: ['#fbfaf8', '#1c1917', '#a16207', '#57534e'],
    brief: `Design direction: ELEGANT SERIF / EDITORIAL.
- Palette: warm paper base (#fbfaf8), near-black ink (#1c1917), muted stone grays (#57534e), a refined gold/bronze accent (#a16207).
- Typography: serif display for headings (Georgia, "Times New Roman", or a system serif), clean sans for body. Strong size contrast, letterspaced small caps for labels.
- Layout: generous margins, measured line length (~65ch), editorial rhythm. Let content breathe.
- Mood: premium, calm, considered. Minimal ornament; elegance from spacing and type.`,
  },
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    description: 'Frosted translucent panels over a colorful blurred backdrop, soft depth and light rims.',
    tags: ['glass', 'translucent', 'blur', 'modern'],
    colors: ['#1e1b4b', '#7c3aed', '#06b6d4', '#ffffff'],
    brief: `Design direction: GLASSMORPHISM.
- Backdrop: rich colorful gradient background (deep indigo #1e1b4b → violet #7c3aed → cyan #06b6d4), optionally with soft blurred blobs.
- Panels: frosted glass — backdrop-filter blur, translucent white fill (rgba(255,255,255,0.08-0.16)), 1px light rim (rgba(255,255,255,0.25)), layered soft shadows for depth.
- Typography: light/medium weights in white/near-white for contrast against the glass.
- Mood: modern, depthful, luminous. Keep text contrast high enough to stay readable over the backdrop.`,
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    description: 'Product-forward: clean cards, clear prices and CTAs, trust signals, conversion-oriented.',
    tags: ['shop', 'store', 'product', 'conversion'],
    colors: ['#ffffff', '#f8fafc', '#111827', '#16a34a'],
    brief: `Design direction: E-COMMERCE.
- Palette: clean white/light surfaces (#ffffff, #f8fafc), near-black text (#111827), a confident "buy" green (#16a34a) for primary CTAs, subtle gray for secondary.
- Layout: product grid with equal cards — image, title, rating, price, add-to-cart. Clear hierarchy so price and CTA pop.
- Components: prominent primary CTA buttons, price emphasized, star ratings, badges (sale/new), trust signals (shipping, returns).
- Typography: legible sans, price larger/bolder than title. Whitespace keeps it shoppable, not cluttered.`,
  },
]

const BY_ID = new Map(DESIGN_PRESETS.map((d) => [d.id, d]))

export function getDesign(id) {
  return id ? BY_ID.get(id) || null : null
}

/** The system-prompt fragment for a design id, or '' when none is selected. */
export function designBrief(id) {
  const design = getDesign(id)
  return design ? `\n## Design style\n${design.brief}\n` : ''
}

/** Compact list for the picker UI (drops the long brief). */
export function designCatalog() {
  return DESIGN_PRESETS.map(({ id, name, description, tags, colors }) => ({
    id, name, description, tags, colors,
  }))
}
