# Design System Single Source of Truth (SSoT)

*A human-readable + agent-enforceable contract for building consistent, accessible UI.*

This file is the canonical truth for UI decisions. **Agents must treat it as law**: if a requirement here conflicts with a task request, this wins unless explicitly overridden.

---

## How Skunkworks Agents Use This File

### Interview Phase
- Asks non-technical questions that map to design knobs (platform, archetype, personality)
- Gathers any existing branding assets (logos, color preferences, reference sites)
- User never sees the YAML - they just answer simple questions

### Architect Phase
- Generates a filled `DESIGN_SPEC.yaml` based on interview answers
- Analyzes any provided visual assets to extract colors and style
- Places the spec in `.skunkworks/DESIGN_SPEC.yaml`

### Builder Phase
- Reads the design spec before writing any UI code
- Uses ONLY tokens from the spec (no magic numbers, no raw hex)
- Follows the component patterns and states defined in the spec

### Reviewer Phase
- Runs the quality gate checklist (Section 10)
- Flags violations of design laws
- Checks accessibility requirements

---

## Agent Persona

**ROLE:** Senior UI/UX Engineer + Design Systems Architect
**VOICE:** Clear, functional, decisive
**DEFAULT STYLE FEEL:** Professional/SaaS, calm + modern
**ANTI-GOAL:** "AI slop" (random CSS vibes; inconsistent spacing/typography; decorative clutter)

---

## Non-Negotiables (Constraints)

1. **Token-only visuals.** No raw "magic numbers" for spacing, font sizes, colors, radii, shadows.
2. **One baseline system.** Choose exactly one reference backbone (Material 3 / Apple HIG / Fluent 2 / Carbon / etc.). This SSoT layers on top.
3. **Accessibility first:** target WCAG 2.2 AA; keyboard-first; visible focus; reduced-motion support.
4. **Touch affordances:** minimum 44px target and ~8px gap between targets; avoid icon-only actions without labels/tooltips.
5. **Semantic structure:** use semantic HTML landmarks (`main`, `nav`, `section`, `header`, `footer`, etc.). Avoid div soup.
6. **Component reuse > invention.** Prefer existing primitives; introduce new components only when necessary.
7. **States are part of the design.** Every interactive element must define hover/focus/active/disabled/loading/error states.
8. **Copy is UI.** Microcopy follows the content rules and errors must be actionable.

---

## Design Knobs (What Gets Set From Interview)

### Product Axes (user answers simple questions that map to these)
| User Question | Maps To | Options |
|--------------|---------|---------|
| "Will people use this on phones, computers, or both?" | platform | web / ios / android / desktop |
| "Is this for your team/company or the public?" | archetype | dashboard / saas_app / marketing / devtool / mobile_consumer |
| "Should it feel professional and serious, or casual and friendly?" | personality | professional / friendly / technical / editorial / playful |
| "Do you need dark mode support?" | modes | light-only / dark-only / both |

### Auto-Derived From Archetype
| Archetype | Density | Color Temp | Motion |
|-----------|---------|------------|--------|
| dashboard | compact | cool | minimal |
| saas_app | normal | cool | functional |
| marketing | spacious | warm | expressive |
| devtool | compact | neutral | minimal |
| mobile_consumer | normal | warm | functional |

---

## Canonical Spec Template (Machine-Readable)

The Architect phase generates this YAML for each project:

```yaml
version: 1
last_updated: "YYYY-MM-DD"

meta:
  project: "Project Name"
  owner: "skunkworks"

product:
  platform: "web"
  archetype: "saas_app"
  baseline_system: "Material3"
  personality: "professional"
  density: "normal"
  modes: ["light", "dark"]
  color_temperature: "cool"
  motion_stance: "functional"

# If user provided branding assets, extracted values go here
branding:
  has_assets: false
  logo_colors: []          # Extracted from logo if provided
  reference_sites: []      # URLs user mentioned as inspiration
  mood: ""                 # User's verbal description ("clean", "fun", etc.)

intent:
  purpose: ""              # From interview: what problem this solves
  audience: ""             # From interview: who uses this
  tone: "conversational, concise, respectful"

principles:
  - "Clarity beats decoration."
  - "Consistency beats cleverness."
  - "Show system status with timely feedback."
  - "Errors explain what happened and how to recover."
  - "Prefer reuse over invention."

accessibility:
  target: "WCAG_2_2_AA"
  keyboard_first: true
  visible_focus: true
  reduced_motion: true
  min_touch_target_px: 44
  min_touch_target_gap_px: 8

layout:
  container_max_width_px: 1280
  gutters_px: 24
  grid_columns: 12
  breakpoints_px: { sm: 640, md: 768, lg: 1024, xl: 1280, xxl: 1536 }

tokens:
  spacing:
    base_px: 8
    aliases_px:
      none: 0
      xs: 4
      sm: 8
      md: 16
      lg: 24
      xl: 32
      xxl: 48

  typography:
    font_sans: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    font_mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    scale:
      display: { size_rem: 2.25, line: 1.15, weight: 700 }
      h1: { size_rem: 1.875, line: 1.20, weight: 700 }
      h2: { size_rem: 1.50, line: 1.25, weight: 650 }
      h3: { size_rem: 1.25, line: 1.30, weight: 650 }
      body: { size_rem: 1.00, line: 1.55, weight: 400 }
      small: { size_rem: 0.875, line: 1.50, weight: 400 }
      caption: { size_rem: 0.75, line: 1.40, weight: 400 }

  radius:
    sm_px: 6
    md_px: 10
    lg_px: 14
    pill_px: 9999

  color:
    semantic:
      light:
        bg/default: "#F8FAFC"
        bg/elevated: "#FFFFFF"
        surface/card: "#FFFFFF"
        text/primary: "#0F172A"
        text/secondary: "#475569"
        border/subtle: "#E2E8F0"
        accent/primary: "#2563EB"
        focus/ring: "#60A5FA"
        danger: "#DC2626"
        success: "#16A34A"
        warning: "#D97706"
      dark:
        bg/default: "#0B1220"
        bg/elevated: "#0F172A"
        surface/card: "#111B2E"
        text/primary: "#E2E8F0"
        text/secondary: "#94A3B8"
        border/subtle: "#22314F"
        accent/primary: "#60A5FA"
        focus/ring: "#93C5FD"
        danger: "#F87171"
        success: "#4ADE80"
        warning: "#FBBF24"

  motion:
    duration_ms: { fast: 150, base: 220, slow: 320 }
    easing:
      standard: "cubic-bezier(0.2, 0, 0, 1)"
      enter: "cubic-bezier(0, 0, 0.2, 1)"
      exit: "cubic-bezier(0.4, 0, 1, 1)"

components:
  primitives: [Button, IconButton, Link, Badge, Input, Textarea, Select, Checkbox, Radio, Switch, Tooltip]
  containers: [Card, SectionHeader, Tabs, Table, EmptyState]
  feedback: [Toast, InlineAlert, ProgressBar, Skeleton]

content:
  voice: "conversational, concise, respectful"
  rules:
    - "Use task-first labels (verbs)."
    - "Errors explain what happened and how to recover."
    - "Confirm destructive actions."
    - "Loading states show progress when possible."
```

---

## Design Laws (Prevents 90% of Ugliness)

1. **Hierarchy uses multiple signals** (size + weight + color; not size alone).
2. **Spacing encodes relationships:** closer = related; farther = separate.
3. **Density dictates spacing:** marketing = air; dashboards = clarity; mobile = one-step tighter horizontally.
4. **Reduce visual noise:** prefer whitespace + subtle elevation over borders everywhere.
5. **Color is semantic, not decorative:** accent is for actions/status; never use color as the only signal.
6. **No gray-on-gray without intent:** if background is gray, secondary text must not fade into invisibility.
7. **States are mandatory:** hover/focus/active/disabled/loading/error exist for every interactive element.
8. **Motion must explain state change:** no decorative loops; always support reduced-motion.
9. **Semantic HTML first:** buttons are `<button>`, links are `<a>`, lists are `<ul>/<ol>`.
10. **60-30-10 sanity check:** most surfaces neutral; accents and CTAs are scarce and purposeful.

---

## Anti-Patterns (What to Reject)

**Hard fails:**
- Mixing baseline systems
- Hardcoded values (raw hex, px values not from the scale)
- Color as the sole signal
- Motion without purpose
- Reinventing components that already exist
- Missing focus styles or keyboard support
- Missing loading/error/empty states

**Red flags in code:**
- `color: #1a2b3c` (should use token)
- `padding: 13px` (should use spacing scale)
- `font-size: 15px` (should use typography scale)
- `<div onClick=...>` instead of `<button>`/`<a>`

---

## Quality Gate Checklist

### Keyboard & Focus
- [ ] All interactive elements reachable by keyboard
- [ ] Focus ring visible and not clipped
- [ ] Tab order matches visual order

### Color & Contrast
- [ ] Text meets contrast target
- [ ] Color is not the only signal
- [ ] Disabled states still readable

### Structure & Reuse
- [ ] Semantic landmarks exist
- [ ] Components reused; no one-off "almost buttons"

### States
- [ ] Loading/saving/error/empty states are present
- [ ] Buttons/inputs define hover/focus/disabled states

### Motion
- [ ] Duration and easing follow tokens
- [ ] Reduced motion path exists

### Copy
- [ ] Labels are verbs
- [ ] Errors tell the user how to fix the problem

---

## Adapting Colors to User Branding

When the user provides a logo or brand colors, the Architect should:

1. **Extract primary color** from the logo (dominant non-neutral color)
2. **Generate a semantic palette** that harmonizes with their brand:
   - `accent/primary` = their brand color (adjusted for contrast if needed)
   - Keep danger/success/warning as standard (red/green/amber) for clarity
3. **Match personality to their aesthetic:**
   - Playful logo/mascot → warmer colors, larger radii
   - Corporate logo → cooler colors, smaller radii
4. **Document the extraction** in the branding section of DESIGN_SPEC.yaml
