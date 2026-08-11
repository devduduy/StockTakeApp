---
name: Hero Operational System
colors:
  surface: '#fbf8fd'
  surface-dim: '#dbd9dd'
  surface-bright: '#fbf8fd'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f7'
  surface-container: '#efedf1'
  surface-container-high: '#e9e7ec'
  surface-container-highest: '#e4e2e6'
  on-surface: '#1b1b1f'
  on-surface-variant: '#45464f'
  inverse-surface: '#303034'
  inverse-on-surface: '#f2f0f4'
  outline: '#757680'
  outline-variant: '#c5c6d0'
  surface-tint: '#4d5d8b'
  primary: '#021541'
  on-primary: '#ffffff'
  primary-container: '#1a2b56'
  on-primary-container: '#8393c5'
  inverse-primary: '#b5c5f9'
  secondary: '#bb0014'
  on-secondary: '#ffffff'
  secondary-container: '#e41f25'
  on-secondary-container: '#fffbff'
  tertiary: '#291300'
  on-tertiary: '#ffffff'
  tertiary-container: '#472400'
  on-tertiary-container: '#bf895b'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae1ff'
  primary-fixed-dim: '#b5c5f9'
  on-primary-fixed: '#051944'
  on-primary-fixed-variant: '#354572'
  secondary-fixed: '#ffdad6'
  secondary-fixed-dim: '#ffb4ab'
  on-secondary-fixed: '#410002'
  on-secondary-fixed-variant: '#93000d'
  tertiary-fixed: '#ffdcc1'
  tertiary-fixed-dim: '#f6ba88'
  on-tertiary-fixed: '#2e1500'
  on-tertiary-fixed-variant: '#663d16'
  background: '#fbf8fd'
  on-background: '#1b1b1f'
  surface-variant: '#e4e2e6'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  mono-data:
    fontFamily: Courier Prime
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

The design system is engineered for the high-stakes environment of enterprise retail inventory management. It prioritizes clarity, speed of cognition, and high-trust interactions. The brand personality is **authoritative, efficient, and resilient**, reflecting the "Hero" namesake by empowering warehouse and retail staff to manage stock with precision.

The visual style follows a **Corporate / Modern** aesthetic with a focus on functional utility. It utilizes a rigorous systematic approach to data visualization, ensuring that variance, shortages, and active counts are immediately identifiable through a disciplined color semiotics system. While the desktop experience is optimized for information density, the mobile HHT (Hand-Held Terminal) experience shifts toward tactical ergonomics with larger touch targets and high-contrast status indicators suitable for rapid scanning in various lighting conditions.

## Colors

This design system utilizes a high-contrast functional palette designed for operational accuracy.

- **Primary (Navy):** Used for structural navigation, headers, and primary actions. It establishes the professional foundation of the interface.
- **Secondary (Hero Red):** Reserved for brand accents and critical interactive highlights. It should be used sparingly to maintain its impact.
- **Semantic Palette:**
    - **Emerald Green:** Denotes 'Active' status, successful matches, and completed stock takes.
    - **Amber:** Signals 'Warnings', pending 'Drafts', or items requiring review before finalization.
    - **Red:** Reserved strictly for 'Shortage', 'Critical Variance', or 'System Errors'.
- **Neutral Palette:** Utilizes a clean white background with off-white/light gray surfaces (#F8FAFC) to create subtle separation in data-heavy tables and card-based layouts on mobile.

## Typography

The typography system uses **Inter** for its exceptional legibility at small sizes and high x-height, which is critical for reading SKU numbers and quantities. 

- **Data Presentation:** For inventory counts and SKU codes, use `mono-data` (Courier Prime) where alignment and character distinction (e.g., 0 vs O) are paramount.
- **Hierarchy:** Use bold weights for headers to maintain structure in dense tables.
- **Mobile Considerations:** In the HHT app, `body-lg` is the default for input fields to ensure visibility at arm's length during scanning operations.
- **Labels:** Use `label-md` for table headers and metadata categories to create a clear visual distinction from the data itself.

## Layout & Spacing

The design system employs a dual-density layout model:

1.  **Web Dashboard (Fixed/Fluid Grid):** Uses a 12-column grid with a 16px gutter. Tables are "Compact" by default, using 8px vertical cell padding to maximize data visibility without scrolling.
2.  **Mobile HHT (Safe Area Layout):** Uses a single-column fluid layout with 16px side margins. Interactive elements (buttons, list items) use a minimum height of 48px to accommodate gloved fingers or rapid thumb-tapping.

**Rhythm:** All spacing is based on a 4px baseline grid. Use `md (16px)` for standard component padding and `lg (24px)` for section spacing.

## Elevation & Depth

This design system uses **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows to maintain a clean, professional feel that doesn't distract from data.

- **Level 0 (Base):** Background (#FFFFFF).
- **Level 1 (Cards/Tables):** Surface (#F8FAFC) with a 1px border (#E2E8F0).
- **Level 2 (Modals/Popovers):** White background with a subtle ambient shadow (Blur 12px, Y 4px, 8% Opacity Black) to provide focus.
- **Interactive States:** Use a 2px Primary Navy outline for focused states on input fields to ensure accessibility compliance.

## Shapes

The shape language is **Soft (0.25rem)**. This provides a professional, modern look that feels precise but more approachable than sharp corners. 

- **Standard Buttons & Inputs:** 4px (0.25rem) corner radius.
- **Containers & Large Cards:** 8px (0.5rem) corner radius.
- **Status Chips:** 100px (Pill) for categorical items like 'Status' to distinguish them from interactive buttons.

## Components

- **Buttons:**
    - *Primary:* Navy background, white text. High-contrast.
    - *Secondary:* White background, Navy border, Navy text.
    - *Destructive:* Secondary Red background, white text (reserved for "Delete Stock Take" or "Clear Scan").
- **Status Chips:**
    - Use the semantic palette with a 10% opacity background of the color and 100% opacity text of the same color (e.g., Emerald Green text on light green tint).
- **Input Fields:**
    - Must include a clear 'Clear' (X) button for mobile users to quickly reset SKU inputs.
    - Large focus rings for operational clarity.
- **Data Tables (Web):**
    - Zebra-striping using Level 1 Surface (#F8FAFC) every second row.
    - Fixed headers for long stock lists.
    - Column alignment: Text left, Numbers/Quantities right.
- **Inventory Cards (Mobile):**
    - Full-width list items with a 48px minimum height.
    - Swipe actions: Left-swipe to delete/remove, Right-swipe to edit/flag.
- **Variance Indicators:**
    - Always pair a color (Red/Green) with a symbol (+/-) or icon (Up/Down arrow) to ensure accessibility for colorblind users.

## Current Product Implementation Notes

The implemented product now spans Android HHT and Angular web. Design decisions should keep both surfaces visually related while respecting their different usage contexts.

- **Web navigation:** Use a collapsible hamburger/sidebar pattern. The main content must keep enough horizontal space for operational tables and rack monitoring.
- **Schedule creation:** The form is intentionally sequential. Location must be selected before stock type, rack scope, and category scope become active.
- **Master Rack:** Rack code creation must feel controlled and data-safe. The code pattern is `RCK-{two letters}-{three digits}`, for example `RCK-FR-001`. Bulk generation should show a preview before save.
- **Validation placement:** Field and duplicate errors should appear inside the active form section, not as detached global dashboard alerts.
- **Rack monitoring:** Dense item lists should prioritize scanning/recheck speed. Use compact rows, strong mono identifiers, and clear status chips.
- **Recheck correction:** `SCAN_QTY` and `FINAL_QTY` should be visually distinct. Corrections must highlight variance without making the table noisy.
- **Print output:** The print sheet is intentionally economical. Avoid decorative boxes that waste paper; keep labels readable and table headers black.
- **Mobile HHT:** Keep primary scan input ready by default, with clean clear actions, editable quantity, and bottom-pinned submit behavior where relevant.

Design polish should avoid generic AI-looking ornaments. Favor simple hierarchy, precise spacing, authentic operational language, and components that feel maintained by a retail systems team.
