---
name: Aeronautical Precision
colors:
  surface: '#10131a'
  surface-dim: '#10131a'
  surface-bright: '#363940'
  surface-container-lowest: '#0b0e14'
  surface-container-low: '#191c22'
  surface-container: '#1d2026'
  surface-container-high: '#272a31'
  surface-container-highest: '#32353c'
  on-surface: '#e1e2eb'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e1e2eb'
  inverse-on-surface: '#2e3037'
  outline: '#849495'
  outline-variant: '#3a494b'
  surface-tint: '#00dbe7'
  primary: '#e1fdff'
  on-primary: '#00363a'
  primary-container: '#00f2ff'
  on-primary-container: '#006a71'
  inverse-primary: '#00696f'
  secondary: '#a7ffb3'
  on-secondary: '#003915'
  secondary-container: '#00ee70'
  on-secondary-container: '#00662c'
  tertiary: '#fff5f0'
  on-tertiary: '#4c2700'
  tertiary-container: '#ffd2af'
  on-tertiary-container: '#914f00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#74f5ff'
  primary-fixed-dim: '#00dbe7'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#66ff8f'
  secondary-fixed-dim: '#00e46b'
  on-secondary-fixed: '#00210a'
  on-secondary-fixed-variant: '#005322'
  tertiary-fixed: '#ffdcc2'
  tertiary-fixed-dim: '#ffb77a'
  on-tertiary-fixed: '#2e1500'
  on-tertiary-fixed-variant: '#6d3a00'
  background: '#10131a'
  on-background: '#e1e2eb'
  surface-variant: '#32353c'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  body-base:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  telemetry-lg:
    fontFamily: JetBrains Mono
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.4'
  telemetry-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.2'
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  sidebar-width: 320px
---

## Brand & Style
The brand personality of this design system is technical, authoritative, and hyper-responsive. It is engineered for high-stakes environments where split-second data visualization is critical. The target audience includes air traffic controllers, logistics operators, and aviation enthusiasts who require a "glass cockpit" experience on their displays.

The design style is a fusion of **Glassmorphism** and **High-Contrast Tech**. It utilizes a deep obsidian foundation to minimize eye strain during long-duration monitoring, overlaid with translucent panels that simulate heads-up displays (HUD). Visual hierarchy is driven by luminescence rather than traditional shadows, using glowing accents to draw attention to critical flight paths and telemetry shifts.

## Colors
This design system utilizes a high-octane dark palette designed for clarity and emotional urgency. 
- **Primary (Electric Cyan):** Used for active flight paths, selection states, and primary navigational links. It represents the "standard" state of focused operation.
- **Secondary (Lime Green):** Reserved for "Safe Zones," cleared landing strips, and successful signal pings.
- **Tertiary (Warning Orange):** Strictly for proximity alerts, weather hazards, and mechanical warnings.
- **Neutral (Obsidian):** The base layer (#0B0E14), providing a void-like depth that allows accented data to pop with maximum contrast.

Background surfaces use a semi-transparent white alpha-channel to create depth without losing the richness of the obsidian base.

## Typography
The typography strategy balances rapid legibility with technical aesthetics. **Inter** serves as the functional workhorse for headers and general UI labels, providing a clean, modern feel. 

**JetBrains Mono** is utilized for all "Telemetry" data roles—including coordinates, altitude, flight numbers, and timestamps. The monospaced nature ensures that fluctuating numbers do not cause layout shifts, maintaining a stable visual field during high-speed data updates. Use `label-caps` for table headers and non-interactive metadata to evoke a military-grade instrumentation look.

## Layout & Spacing
The layout employs a **Fluid Grid** for the central tactical map and a **Fixed Sidebar** for flight manifests and detailed telemetry. 

- **The Tactical Map:** Fills all available viewport space between sidebars. It features a "Radar Grid" overlay—concentric circles radiating from the user's location at 50km intervals.
- **Sidebars:** Fixed at 320px to ensure data density remains consistent. 
- **Breakpoints:** On mobile, the sidebars collapse into bottom-sheet overlays, prioritizing the map.
- **Rhythm:** An 8px base unit governs all padding and margins, ensuring a tight, industrial alignment.

## Elevation & Depth
Depth is created through **Tonal Layers** and **Backdrop Blurs** rather than traditional drop shadows. 

1.  **Level 0 (Base):** The #0B0E14 obsidian background.
2.  **Level 1 (Panels):** Surfaces use a 3% white fill with a `backdrop-filter: blur(12px)`. These panels are outlined with a 1px border in `border_color_hex`.
3.  **Level 2 (Modals/Overlays):** A higher opacity surface (8%) with a 20px blur and a subtle glow (0 0 15px) using the Primary Cyan at 10% opacity.

This approach creates the "HUD" effect, making data appear as if it is floating in the airspace above the map.

## Shapes
This design system utilizes a **Soft (0.25rem)** roundedness level to maintain a professional, precision-instrument feel. 

Sharp corners feel too dated/brutalist, while fully rounded corners feel too consumer-friendly. The 4px radius (Level 1) provides a subtle softening that works well with 1px glowing strokes. Buttons and high-priority flight "pips" may use a pill-shape (Level 3) to differentiate interactive elements from static informational panels.

## Components
- **Flight Cards:** Translucent containers with a 1px top-highlight. They feature a "sparkline" flight path and a primary label in JetBrains Mono.
- **Radar Pips:** Circular icons representing aircraft. Active selection should have a "pulsing" Cyan ring animation.
- **Status Chips:** Small, solid-color blocks (Cyan, Green, or Orange) with white text. No background blur for these; they must be high-contrast for instant recognition.
- **Buttons:** Ghost-style borders by default. Primary buttons should have a subtle outer glow and "inner-shadow" glass effect.
- **Data Tables:** Borderless rows separated by 1px lines at 5% opacity. Column headers must use the `label-caps` typography style.
- **Proximity Alerts:** When two pips come within a 100m radius, a dashed Orange line should connect them, accompanied by a vibrating Tertiary Orange border on their respective detail cards.