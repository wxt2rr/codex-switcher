## ADDED Requirements

### Requirement: Product homepage communicates the product value
The website SHALL provide a Chinese product homepage at `/zh/` that explains the product positioning, environment/account concepts, supported capabilities, launch workflow, supported platforms, privacy posture, downloads, and FAQ.

#### Scenario: User opens the product homepage
- **WHEN** a user visits `/zh/`
- **THEN** the page shows a hero statement, primary download/documentation actions, real product preview, and links to the major product sections

#### Scenario: User evaluates core capabilities
- **WHEN** a user reads the feature and workflow sections
- **THEN** the page explains environment isolation, account switching, custom models, CLI/App launch, local routing, and usage analytics without claiming features not present in the desktop app

### Requirement: Website follows the desktop visual language
The website SHALL use the shared codex-switcher design tokens for typography, colors, borders, selected states, spacing, radii, and shadows.

#### Scenario: User compares desktop and website surfaces
- **WHEN** the same user views a website card, primary action, selected action, success state, or destructive action and the corresponding desktop surface
- **THEN** the visual semantics remain consistent in color, density, border treatment, and interaction feedback

### Requirement: Website is responsive and accessible
The website SHALL support desktop, tablet, and mobile layouts and provide semantic headings, keyboard-focusable navigation, accessible labels, and readable contrast.

#### Scenario: User visits on a narrow viewport
- **WHEN** the viewport is narrower than the desktop breakpoint
- **THEN** navigation collapses without clipping, content remains readable, and screenshots/cards fit the viewport without horizontal scrolling

### Requirement: Website exposes release downloads
The website SHALL show current macOS and Windows download links from public GitHub Releases, with a fallback link to the releases page when release metadata cannot be loaded.

#### Scenario: Release metadata is available
- **WHEN** the website build can read the configured GitHub Release metadata
- **THEN** the download section shows the version and matching platform assets

#### Scenario: Release metadata is unavailable
- **WHEN** the release API is unavailable or returns incomplete metadata
- **THEN** the site still builds and presents a working link to the repository Releases page
