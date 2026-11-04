# FreeTTS Design System (Track A contract)

**Status:** living contract — every track builds against these tokens and rules.
**Mandate:** distinctive, mature, premium product craft (Linear/Speechify restraint).
**Anti-mandate:** no purple/blue gradients, no glassmorphism excess, no glowing
effects, no giant headings, no floating decorations, no generic AI-landing
layouts, no emoji icons (Lucide only), no fake dashboards/stats, no animation
excess.

## 1. Color — monochrome-first, one restrained accent

Token NAMES are the contract (shadcn/OKLCH semantics). Other tracks must never
hardcode a color in a component — use `bg-background`, `text-foreground`,
`border-border`, `bg-card`, `text-muted-foreground`, `bg-primary`, etc.

Base palette: warm-neutral monochrome (hue ≈ 95, chroma ≈ 0), light and dark
both supported. The only chromatic token in the system:

| Token | Light | Dark | Rule |
|---|---|---|---|
| `--success` | `oklch(0.55 0.15 160)` deep emerald | `oklch(0.72 0.14 160)` | **Live / generating / success states ONLY.** Toast success icon, "speaking now" indicators, the WebGPU-active icon in Studio. Never for brand, never for decoration, never for primary CTAs. |
| `--success-foreground` | near-white | dark emerald | Text on success fills (rare; prefer the icon form). |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | Destructive actions and error states. Kept red per convention. |

Restraint rules:
- Primary stays near-black (light) / near-white (dark). The brand mark is a
  monochrome chip, not a colored logo.
- No second accent exists. A state that isn't success/live/error is
  `text-muted-foreground` — not a tinted icon, not a colored badge. (The old
  Studio CPU icon was `text-amber-600`; it is now `text-muted-foreground`.)
- Do not invent new hue tokens without amending this file and getting Muteeb's
  sign-off. The one-accent rule is deliberate.

## 2. Typography — Geist only

- **Display / page titles:** `text-3xl font-bold tracking-tight`
  (one per page, never larger — no giant headings).
- **Section titles:** `text-base font-semibold tracking-tight`
  (card titles use `text-base`; dialog titles `text-base font-semibold`).
- **Body:** `text-sm` default in cards and content.
- **Small / meta:** `text-xs text-muted-foreground`.
- **Mono:** Geist Mono for identifiers, byte counts, cache names, model names
  (`font-mono`).
- Numerals that change (speed, progress, percentages): `tabular-nums`.
- `antialiased` is set on `<html>`; do not override.

## 3. Spacing

- Page container: `mx-auto max-w-6xl px-4` (shell-owned; pages use narrower
  `max-w-3xl/5xl` inside only where the content is genuinely narrow).
- Vertical rhythm inside a page: `space-y-6` between blocks, `space-y-1/2`
  inside blocks.
- Component internals: `gap-2/3` default; generous `px-6 py-12` on empty
  states; `p-6` dialog, `p-4` toast.

## 4. Radius — modest and consistent

Base `--radius: 0.625rem`. Use `rounded-lg` for cards/dialogs/buttons,
`rounded-md` for inputs/selects/badges, `rounded-xl` only for large
containers (toasts, empty states). Not rounded-everything: icon chips
`rounded-lg`, avatars (if ever) `rounded-full` by exception only.

## 5. Buttons & inputs

- **Primary:** `variant="default"` — the Generate-style action. One per view.
- **Secondary/outline:** supporting actions. **Ghost:** nav, icon buttons,
  dismiss. **Destructive:** soft red (`bg-destructive/10`), never solid red
  except inside a confirmation dialog.
- Focus: `focus-visible:ring-2/3 ring-ring/50` — visible, never removed.
- Inputs/selects/sliders/switches come from `components/ui/*` and are already
  tokenized; do not restyle per-page.

## 6. Icons — Lucide only, no emoji

Sizes: `h-4 w-4` inline with text, `h-3.5 w-3.5` inside buttons,
`h-5 w-5` in nav tabs, `h-10 w-10` chip for empty-state icons.
`strokeWidth` 2 default; active tab icons may use 2.25 for weight contrast.
Icons are decorative duplicates of a visible label or carry an `aria-label` —
never emoji, never color as the only signal.

## 7. Elevation — subtle shadows only

`shadow-lg` for dialogs and toasts (floating layers). `shadow-md` for
popovers/select content. Cards sit flat on `border` — no shadows, no glow.
Overlays dim with `bg-foreground/40`, never a gradient scrim.

## 8. Animation — purposeful, 150–250ms

- Transitions: `duration-200` (dialogs, toasts), `duration-100` (popovers,
  tooltips). `animate-in`/`animate-out` with `fade-in-0` + `zoom-in-95` or
  small `slide-in-from-*` via tw-animate-css.
- `animate-spin` for genuine loading spinners; `animate-pulse` for skeletons.
- No bounce, no spring excess, no entrance choreography, no decorative motion.
- Toasts auto-dismiss at 4.5s (errors 6s), swipe-to-dismiss, max 3 stacked.

## 9. Dark mode

Class toggle on `<html>` (`.dark`), with a pre-paint script in
`app/layout.tsx` to avoid flash. Every token has a dark value; the warm
shift is preserved, not inverted away. Never use `dark:` overrides for
one-off colors — if a component needs a dark-specific color, it needs a
token. The sidebar dark primary was a blue-violet; it is now monochrome.

## 10. Navigation (app shell)

- Desktop: sticky top bar (`h-14`, `border-b`, `bg-background/80 backdrop-blur`)
  with ghost-button nav, active item `bg-accent text-accent-foreground`,
  `aria-current="page"`.
- Mobile (<md): fixed bottom tab bar — Studio, Voices, History, Settings,
  Privacy — icon + 11px label, active `text-foreground` vs
  `text-muted-foreground`, `aria-selected` + `role="tablist"`. Fixed
  positioning means no layout shift; `<main>` carries `pb-24 md:pb-8` to
  clear it, plus `env(safe-area-inset-bottom)`.
- Routes: `/` Studio, `/voices`, `/history` (Track C), `/settings`,
  `/privacy`. Nav items live in one `NAV` array in `components/site-header.tsx`.

## 11. New primitives (components/ui)

| Primitive | File | Used where (real) |
|---|---|---|
| `Dialog` (+ Header/Footer/Title/Description/Overlay/Close) | `dialog.tsx` | Settings → "Delete downloaded models" confirmation (replaces native `confirm()`). Track C: history item deletion confirm. |
| `toast()` / `<Toaster />` | `toast.tsx` | Mounted once in `app/layout.tsx`. Settings → success/error on model-cache deletion. API: `toast.success(title, desc?)`, `toast.error(title, desc?)`. |
| `EmptyState` | `empty-state.tsx` | Voices → zero filter results (with Clear-filters action). Track C: empty history. |
| `Skeleton` | `skeleton.tsx` | Voices → loading cards. Rule: skeletons for loading, EmptyState for genuinely empty. |

## 12. The "every control must work" law

Every visible control in the shipped UI performs its real function. No
decorative buttons, no dead links, no placeholder tabs, no fake stats.
If a track adds a control, it wires it in the same change. The footer
carries only true statements: on-device synthesis, Kokoro-82M (Apache-2.0)
via kokoro-js, English-only in this version, GPL-3.0-or-later.

## 13. Files owned by Track A

`app/globals.css`, `app/layout.tsx`, `components/site-header.tsx`,
`components/ui/*`, `docs/DESIGN.md`. Track A also made minimal
contract-conformance edits outside these files: `app/page.tsx`
(hardcoded `text-green-600`/`text-amber-600` → `text-success` /
`text-muted-foreground`) and `app/settings/page.tsx`,
`app/voices/page.tsx` (primitive integrations). Do not reintroduce
hardcoded colors in those pages.
