# GitStarRecall UI/UX Improvement Plan

## Purpose
This document is an implementation-grade redesign spec for turning GitStarRecall from a side-project style interface into a polished, keyboard-first developer product.

The intended product quality bar is: calm, precise, fast, local-first, and obvious to scan. The end state should feel closer to Raycast, Linear, Vercel, Arc, or Stripe than a single-page utility dashboard.

This document is written for an AI coding agent working in the current React + Vite + Tailwind + shadcn codebase.

## Product Direction
### Product Thesis
GitStarRecall should feel like a local developer memory workspace for GitHub stars, not a collection of controls.

The core promise is not "search your starred repos". The real promise is:
- remember what you saved,
- recover it quickly,
- understand why it matched,
- turn matches into a working context for chat and follow-up exploration.

### UX Principles
- Search-first: the product should revolve around recall, not setup panels.
- Keyboard-first: every primary action should be reachable without the mouse.
- Local-first trust: the UI must clearly show what stays local and what leaves the device.
- Progressive disclosure: power-user settings stay available but do not dominate the main workflow.
- Context-explicit: chat context must be visible and editable, not hidden in implementation details.
- Scan speed over decoration: engineers should be able to parse state, results, and actions in seconds.

### Non-Goals
- Do not turn the product into a generic marketing-heavy SaaS dashboard.
- Do not add server-side dependencies for core search/chat UX.
- Do not expose advanced embedding/runtime controls in the primary workflow by default.
- Do not rely on color alone to communicate system state.

## Current UX Problems

### 1. The app has no real information architecture
Current routes are only:
- `/` -> `src/pages/LandingPage.tsx`
- `/app` -> `src/pages/UsagePage.tsx`
- `/auth/callback` -> `src/pages/auth/AuthCallbackPage.tsx`

All authenticated behaviors live inside `src/pages/UsagePage.tsx`, which is currently 3436 lines long. The UI architecture mirrors that code architecture: sync, embeddings, search, filters, sessions, chat, provider config, account actions, and developer controls all coexist in one dense surface.

Impact:
- users must infer the product model from the order of panels,
- there is no stable mental model for where to find things,
- complex states are hard to discover and easy to miss.

### 2. Search and sync are coupled in a way that increases cognitive load
`src/components/SearchBar.tsx` places the primary search input and `Sync Stars` action on the same row.

Impact:
- users cannot tell whether search is querying live GitHub state or the local index,
- sync feels like a prerequisite button instead of a background system capability,
- the main search affordance looks operational instead of product-grade.

### 3. Configuration overwhelms the main task
Immediately below the search input, `UsagePage` renders:
- `OllamaConfigPanel`
- `DeveloperModePanel`
- `SyncStatusBar`

Impact:
- the first screen after login is dominated by runtime and infrastructure concerns,
- first-time users are asked to think about embeddings and provider settings before they understand the product,
- routine users repeatedly scan controls they rarely need.

### 4. Session model is unclear and weakly discoverable
Session state currently appears in two places:
- `FilterBar` uses `New session` / `Continue` radio buttons,
- `SessionSidebar` appears below the results region in the chat section.

Impact:
- session creation is implicit instead of intentional,
- session navigation is visually separated from search results,
- the relationship between query, results, and chat thread is not obvious.

### 5. Chat context is hidden
`handleGenerateAnswer` in `src/pages/UsagePage.tsx` sends the top 8 filtered snippets as chat context. This is not made explicit in the UI beyond a small helper line.

Impact:
- users cannot confidently predict what the model is using,
- filter changes can silently alter chat context,
- trust is lower because the retrieval-to-generation handoff is opaque.

### 6. Result browsing is too shallow for rediscovery
`RepoResultCard.tsx` shows:
- repo name,
- score badge,
- language,
- up to 3 topics,
- a short snippet.

Missing or underdeveloped:
- a detail panel,
- explicit reason-for-match breakdown,
- quick actions,
- collection/tagging workflows,
- side-by-side comparison,
- keyboard selection.

Impact:
- the app can retrieve results but does not yet help users rediscover and act on them.

### 7. The product is not keyboard-first
Current keyboard support is limited to:
- `Enter` to run search,
- `Enter` to send chat,
- dialog tab trapping in `WebLLMDownloadDialog`.

Missing:
- global command palette,
- list navigation,
- focus shortcuts,
- result actions,
- session switching shortcuts,
- filter shortcuts,
- contextual quick actions.

### 8. Visual hierarchy is too small and too flat
Many controls use `text-xs`, `text-[11px]`, and `h-6` to `h-8` sizing across:
- `FilterBar`
- `SessionSidebar`
- `SyncStatusBar`
- `DeveloperModePanel`
- `OllamaConfigPanel`
- parts of `SessionChat`

Impact:
- important controls violate Fitts's Law,
- scanning is harder on dense screens,
- the product reads like internal tooling rather than premium developer software.

### 9. Landing and app surfaces feel like two different products
The landing page uses expressive gradients and motion, while the app surface is a centered card full of operational controls.

Impact:
- the transition from marketing to product feels abrupt,
- the in-app experience underdelivers relative to the promise.

### 10. Status and feedback are technically correct but not productized
`SyncStatusBar` currently mixes:
- sync/indexing state,
- storage mode,
- history restore status,
- embedding telemetry.

Impact:
- feedback exists, but it is not organized by urgency or user intent,
- operational details compete with actionable signals,
- progress is readable for the builder, not optimized for the operator.

### 11. Login/setup UX still feels technical
`LoginCard.tsx` exposes the OAuth redirect URI directly, and the setup flow depends on the user understanding sync/indexing mechanics.

Impact:
- trust is present, but polish is not,
- setup feels like configuration rather than guided onboarding.

## Proposed UX Architecture Redesign

### Core Product Objects
Make the product model explicit around five first-class objects:
- Workspace: auth state, sync health, corpus health, provider health.
- Repo: the rediscoverable object.
- Search: the recall action that produces a result set.
- Session: a saved investigation thread anchored to a query/result set.
- Context Set: the explicit repos/snippets selected for chat.

### Target Route Structure
Replace the single `/app` view with a proper app shell and nested routes.

Recommended routes:
- `/` -> public landing
- `/auth/callback` -> auth completion state
- `/app` -> redirects intelligently based on state
- `/app/setup` -> first-run setup and indexing
- `/app/recall` -> primary search and rediscovery workspace
- `/app/library` -> browsable library of starred repos
- `/app/sessions` -> search/chat history
- `/app/settings` -> GitHub, embeddings, providers, privacy, data, developer

State-driven default routing:
- unauthenticated -> `/`
- authenticated + zero repos -> `/app/setup`
- authenticated + repos but zero embeddings -> `/app/setup`
- authenticated + ready index -> `/app/recall`

### App Shell
Adopt a persistent shell instead of a centered single-page card.

Desktop shell:
- Left rail: brand, primary nav, command palette trigger, sync health dot, settings.
- Secondary sidebar: page-specific collections (saved views, filters, sessions, tags).
- Main content: query canvas, list/table, or session transcript.
- Right detail panel: repo preview, context stack, or inspector.

Tablet shell:
- left rail remains,
- secondary sidebar collapses to a slide-over panel,
- right detail panel becomes toggleable.

Mobile shell:
- top command bar,
- bottom tab bar for `Recall`, `Library`, `Sessions`, `Settings`,
- filters and detail views open as sheets.

### Proposed Primary Navigation
Use four top-level product areas.

1. Recall
- Main search workspace.
- Combines semantic search, result review, context curation, and quick chat.
- This should be the default destination once the user has indexed data.

2. Library
- Full inventory of repos.
- Table/list view with sort, tags, topics, language filters, sync freshness, and saved views.
- Better for browsing than asking a query.

3. Sessions
- Search history and ongoing conversations.
- Users can reopen, rename, compare, resume, or archive investigation threads.

4. Settings
- GitHub connection,
- sync behavior,
- embedding engine,
- provider permissions,
- local data,
- developer mode.

### Setup Flow Redesign
Current behavior requires the user to understand manual sync and embedding setup quickly. Replace that with a guided setup sequence.

#### Setup Sequence
1. Connect GitHub
- Primary CTA: `Connect GitHub`
- Secondary CTA: `Use Personal Access Token`
- Explain local-first behavior in one short paragraph.

2. Build your local index
- Explain three stages in plain language:
  - import stars,
  - fetch READMEs,
  - create embeddings.
- Default to automatic recommended embedding engine.
- Show progress as a vertical checklist with clear completion marks.

3. Start recalling
- Present sample searches and recent repo topics as suggested prompts.
- Route into `/app/recall` immediately after indexing is ready.

#### Setup Principles
- Keep advanced runtime configuration behind `Customize indexing`.
- Do not surface `DeveloperModePanel` during first-run setup.
- Do not show raw technical terms until the user asks for them.

### Search Flow Redesign
#### Current Problem
Search runs a strong backend flow, but the UX only exposes a query box and a flat result list.

#### Target Flow
1. User opens `Recall` or presses `Cmd/Ctrl+K`.
2. User types a natural-language memory or exact repo name fragment.
3. UI shows instant local suggestions while typing:
- recent searches,
- matching repo names/topics,
- sessions,
- command actions.
4. User confirms semantic search.
5. Results appear in a structured split view:
- center list of repo matches,
- right panel with selected repo details,
- context tray showing which repos are selected for chat.
6. User refines via chips, keyboard actions, or contextual quick actions.
7. User opens chat with explicit selected context, not hidden top-N snippets.

### Rediscovery Flow Redesign
Rediscovery is not the same as search. The product should explicitly support the moment where the user thinks, "This might be it. Let me inspect, compare, and decide."

Target rediscovery behaviors:
- single keypress preview of the selected repo,
- `Open on GitHub`, `Copy URL`, `Add tag`, `Add to context`, `Start session from repo`, `Filter by topic`, `Filter by language`,
- side panel showing why it matched,
- snippet-level evidence grouped by repo,
- ability to pin promising repos into a temporary working set.

### Chat Flow Redesign
#### Current Problem
Chat is anchored to the active session but context selection is implicit and provider control is hidden.

#### Target Flow
1. Search results populate a visible `Context` tray.
2. By default, the top 3 to 5 repos are auto-added with a visible label: `Auto-selected from search`.
3. Users can add/remove repos and snippets before sending to the model.
4. Composer shows a compact disclosure:
- `Using 5 repos / 8 snippets`
- `Local model` or `Remote provider`
5. Remote usage warning appears inline only when relevant.
6. Provider details live in Settings, with quick provider switching exposed in a compact but readable dropdown near the composer.

### Sync and Embedding Flow Redesign
Move sync/indexing from an inline form-adjacent block to a system-level pattern.

Target model:
- Global sync indicator in the app shell.
- `Sync Center` panel opened from the top bar or command palette.
- Background sync banner when updates are running.
- Search remains usable against the current local index when safe.
- Initial setup uses a dedicated progress view; routine sync uses a compact status surface.

Sync Center should show:
- last successful sync time,
- corpus size,
- README freshness status,
- embedding backend/model,
- active job progress,
- recent warnings/errors,
- `Run sync now`, `Resume indexing`, `Rebuild embeddings` actions.

## New Navigation and Interaction Model

### Desktop Layout System
Use a three-region app shell on large screens.

Recommended desktop frame:
- left rail: 72 px
- secondary sidebar: 280 px
- main content: fluid, minimum 640 px
- detail panel: 360 to 420 px

#### Left Rail Contents
Top:
- logo
- command palette button with shortcut hint

Middle:
- `Recall`
- `Library`
- `Sessions`
- `Settings`

Bottom:
- sync health dot
- local-first/privacy indicator
- user/account menu

#### Top Command Bar
Persistent in the main content area.

Contains:
- page title,
- global command/search trigger,
- current sync health,
- compact provider status,
- optional action button relevant to the current page.

### Recall Workspace Layout
Desktop recall workspace should use:
- top: large omnibox + filter chips,
- center-left: result list,
- right: repo detail and context tabs.

Recommended right panel tabs:
- `Preview`
- `Context`
- `Why it matched`

### Library Layout
Use a denser list/table pattern for scanning.

Columns:
- repo,
- language,
- tags,
- topics,
- updated,
- stars/forks,
- sync freshness,
- actions.

Behavior:
- click row selects preview in right panel,
- double-click or `Enter` opens on GitHub,
- `Space` adds/removes from context tray.

### Sessions Layout
Use a two-column layout:
- left: session list with query, updated time, result count, message count,
- right: session overview or transcript preview.

Add actions:
- rename session,
- duplicate query,
- resume in Recall,
- archive/delete,
- compare two sessions later if desired.

### Settings Layout
Use sectioned settings, not collapsible fragments mixed into workflow pages.

Recommended sections:
- GitHub
- Sync & Indexing
- Embedding Engine
- Chat Providers
- Privacy & Permissions
- Local Data
- Developer

### Mobile Interaction Model
- Use a compact top search/command trigger.
- Replace sidebars with sheets.
- Keep chat composer sticky to bottom.
- Collapse the right detail panel into a bottom sheet with tabs.
- Use horizontal chip carousels for filters.

## Raycast-Style Command Interface Design

### Why the Command Interface Matters
GitStarRecall is fundamentally a memory tool for engineers. The fastest interaction model is not clicking nested UI. It is:
- invoke,
- type vague memory,
- see options instantly,
- commit to an action.

### Trigger and Placement
Primary triggers:
- `Cmd/Ctrl+K`: open global command palette
- `/`: focus search when inside `Recall`
- `G` then `R/L/S`: go to Recall/Library/Sessions
- `Esc`: close palette or clear transient selection

Secondary triggers:
- command icon in top bar
- command button in left rail

### Palette Modes
The palette should support multiple intent types from one input.

#### Default Mixed Mode
Search across:
- commands,
- repos,
- tags,
- sessions,
- filters,
- settings pages.

#### Prefix Modes
Support lightweight prefixes for power users.
- `>` command mode
- `@` sessions
- `#` tags/topics
- `/` semantic search query
- `:` navigation targets

Examples:
- `/ graphql auth library`
- `@ vector search` -> find prior sessions
- `# typescript` -> filter library by topic/language tag
- `> sync stars` -> run sync
- `:settings providers` -> jump to provider settings

### Palette Result Groups
Order groups by intent value.

1. Actions
- Sync stars
- Resume indexing
- Rebuild embeddings
- Open Recall
- Open Library
- Open Sessions
- Open Settings
- Toggle local provider permission
- Toggle remote provider permission
- Clear filters
- Create tag

2. Repo Matches
- fuzzy match on `name`, `fullName`, `description`, `topics`, `language`
- shows language badge, updated time, and action hint

3. Session Matches
- query text, last updated time, message count

4. Suggested Searches
- recent searches
- empty-state prompt templates
- generated suggestions from top topics/languages

### Palette Interaction Rules
- Arrow keys move active item.
- `Enter` performs primary action.
- `Cmd/Ctrl+Enter` opens selected repo in GitHub.
- `Shift+Enter` opens selected item in side panel without leaving palette context.
- `Tab` fills the active chip/filter suggestion into the query.
- `Backspace` on empty query moves back one prefix mode or removes the last active chip.

### Quick Actions for Repos
Every repo item in the palette should expose a secondary action row or right-side hint menu.

Required quick actions:
- open preview
- open on GitHub
- add/remove tag
- add/remove from chat context
- start new session from this repo
- filter by language
- filter by topic
- copy repo URL

### Quick Actions for Sessions
- resume session
- rename
- duplicate search
- open transcript
- archive

### Fuzzy Search Strategy
Do not block the palette on semantic embeddings.

Use two layers:
1. Instant fuzzy search over local metadata for perceived speed.
2. Semantic search only when the user confirms a natural-language query.

Implementation guidance:
- start with a lightweight in-memory scorer using current repo/session metadata,
- only add `Fuse.js` if quality is clearly insufficient,
- rebuild the fuzzy index after sync completion or tag changes,
- keep palette open time under 80 ms.

### Command Palette Components
Add via shadcn CLI, not direct Radix installs.

Recommended primitives to add:
```bash
pnpm dlx shadcn@latest add command dialog sheet tabs dropdown-menu breadcrumb
```

## Complete UI System

### Visual Identity
Target aesthetic: precision-industrial.

Descriptors:
- graphite surfaces,
- sharp but quiet contrast,
- cool neutrals with restrained green and amber accents,
- mono metadata paired with a clean technical sans,
- subtle motion and illuminated focus edges,
- no playful gradients as the primary interface language.

This should feel like a serious local developer instrument.

### Color System
Use semantic tokens, not page-level custom values.

#### Core Tokens
```css
:root {
  --bg-app: #0b0f14;
  --bg-canvas: #0f141b;
  --bg-surface: #151c24;
  --bg-surface-2: #1b2430;
  --bg-surface-3: #222d3b;

  --text-primary: #f3f7fb;
  --text-secondary: #9aa6b2;
  --text-tertiary: #71808f;

  --stroke-subtle: rgba(255, 255, 255, 0.08);
  --stroke-strong: rgba(255, 255, 255, 0.14);

  --accent-primary: #7ce2b7;
  --accent-primary-strong: #3fd39a;
  --accent-info: #71b7ff;
  --accent-warning: #ffbf66;
  --accent-danger: #ff7d7d;

  --focus-ring: rgba(124, 226, 183, 0.45);
  --selection-bg: rgba(124, 226, 183, 0.12);
  --overlay: rgba(8, 12, 16, 0.72);
}
```

#### Usage Rules
- Green is for ready/confirmed/local-safe states.
- Blue is for navigation and neutral info.
- Amber is for sync/indexing/in-progress states.
- Red is for destructive/error states.
- Avoid bright gradients on primary work surfaces.
- Use gradients only in landing hero, empty-state accents, and subtle shell overlays.

### Typography
Recommended font stack:
- Display/UI headings: `Archivo`
- Body/UI text: `IBM Plex Sans`
- Code/metadata: `IBM Plex Mono`

Implementation note:
- replace `Syne` and `DM Sans` in `src/index.css`
- use a tighter typographic system with fewer novelty flourishes in-product

#### Type Scale
- Display XL: 40/48, 700
- Display L: 32/40, 700
- H1: 24/32, 600
- H2: 20/28, 600
- H3: 16/24, 600
- Body M: 14/22, 400
- Body S: 13/20, 400
- Label: 12/16, 500
- Mono S: 12/16, 500

Rules:
- Avoid 10 px text except for non-critical keyboard hint caps.
- Use mono only for code, counts, provider/model labels, repo metadata, and shortcuts.

### Spacing System
Use an 8 px base scale.

Primary spacing tokens:
- 4
- 8
- 12
- 16
- 20
- 24
- 32
- 40
- 48
- 64

Rules:
- standard panel padding: 16 or 20
- page section gap: 24
- list item vertical rhythm: 12 to 16
- control minimum height: 40
- icon button minimum hit area: 40 x 40

### Radius and Elevation
- Shell panels: 16 px
- Inputs/buttons/chips: 12 px
- Tiny pills: 999 px

Shadows:
- use low, wide shadows with clear borders,
- rely more on layered surfaces than heavy blur.

### Motion System
Motion should be restrained and functional.

Use motion for:
- shell/page entrance,
- command palette open/close,
- list hover/focus,
- sync progress transitions,
- chat streaming affordance,
- panel expansion.

Timing:
- 120 ms: hover/focus
- 180 ms: list/panel transitions
- 220 ms: overlay open/close
- 320 ms: onboarding state transitions

Easing:
- `cubic-bezier(0.2, 0.8, 0.2, 1)` for most UI motion

Reduced motion:
- eliminate transform-heavy movement,
- preserve opacity-only transitions where helpful.

### Layout Primitives
Create reusable primitives instead of ad hoc containers.

Required primitives:
- `AppShell`
- `PageHeader`
- `CommandTrigger`
- `SectionCard`
- `PanelStack`
- `ListPane`
- `DetailPane`
- `StatusStrip`
- `ChipBar`
- `EmptyStatePanel`

### Component System

#### 1. AppShell
Purpose:
- shared authenticated frame.

Responsibilities:
- navigation,
- sync health visibility,
- command palette mounting,
- route-specific regions.

#### 2. CommandPalette
Purpose:
- global command and search entry point.

States:
- closed,
- open-default,
- prefix mode,
- no results,
- loading semantic query.

#### 3. WorkspaceSearchBar
Purpose:
- large omnibox in `Recall` page.

Behavior:
- accepts semantic query,
- supports filter chips inline,
- supports suggested prompts,
- shows search status below input.

#### 4. ResultListItem
Replace the current card-only treatment in dense list contexts.

Fields:
- repo name,
- score band,
- description,
- topics,
- language,
- updated date,
- action hints.

States:
- idle,
- hover,
- keyboard active,
- selected,
- in-context.

#### 5. RepoDetailPanel
Purpose:
- support rediscovery and decision-making.

Sections:
- overview,
- why it matched,
- matched snippets,
- topics/language,
- last updated,
- actions.

#### 6. ContextTray
New component. This is critical.

Purpose:
- show which repos/snippets will be sent to the LLM.

Actions:
- remove item,
- pin item,
- reorder if needed,
- clear all,
- start chat.

#### 7. SyncCenter
Purpose:
- central system-status surface.

Contains:
- corpus stats,
- last sync,
- current job progress,
- embedding backend/model,
- actions.

#### 8. SessionList
Purpose:
- make history feel like saved work, not a side widget.

Fields:
- session title,
- original query,
- updated time,
- result count,
- message count,
- current provider badge if relevant.

#### 9. ChatComposer
Purpose:
- explicit prompt composer with visible context and provider.

Do not hide critical provider consent in a tiny icon-only settings popover.

Preferred layout:
- top row: provider pill, context count, remote/local warning when needed
- body: textarea
- footer: actions, keyboard hint, model switcher dropdown

#### 10. TagChip and Saved Views
New concepts.

Minimal feature set:
- local-only custom tags,
- saved view presets (`Recently Updated`, `TypeScript`, `Infra`, `AI`, `Needs Review`),
- smart views based on existing metadata.

## Page-by-Page UI Redesign

### 1. Public Landing Page
Current file: `src/pages/LandingPage.tsx`

#### Problems
- visually stronger than the product itself,
- lacks a real product screenshot or workflow visualization,
- sells concept more than confidence.

#### Redesign
Structure:
- Hero with real product mockup, not only text and badges
- Trust strip: local-first, private by default, GitHub OAuth, open source
- 3-step workflow: connect, index, recall
- feature blocks focused on outcomes, not implementation details
- `See the workspace` and `Connect GitHub` CTAs

Behavior:
- keep expressive motion, but align color/typography with the app shell
- reduce glow density
- show one clean dashboard screenshot

### 2. Auth Callback Page
Current file: `src/pages/auth/AuthCallbackPage.tsx`

#### Redesign
- use branded progress state with clear steps:
  - validating GitHub response,
  - creating local session,
  - redirecting to workspace
- on failure, provide:
  - retry,
  - return home,
  - troubleshooting link

### 3. Setup Page
New page: `src/pages/app/SetupPage.tsx`

#### Layout
- center column with progress stepper on first run
- optional right panel with `Local-first` explanation and advanced options

#### Required States
- not connected
- connected, ready to sync
- syncing/importing
- indexing
- complete
- failure/retry

#### Required Actions
- connect GitHub
- use PAT
- start sync
- customize embedding engine
- continue to Recall

### 4. Recall Page
New page: `src/pages/app/RecallPage.tsx`

#### Layout
Top:
- page title
- command/search omnibox
- chips for active filters and scope

Main split:
- center: results list
- right: repo detail / context tabs

Bottom or lower-right anchored:
- chat composer and transcript preview for active session

#### Empty State
When the user has data but no active query, show:
- recent searches
- suggested prompt templates
- recently updated repos
- popular topics from local library

Suggested prompt examples:
- `I starred a TypeScript auth repo with a clean architecture setup`
- `browser-based vector database`
- `GraphQL security testing toolkit`

#### Search Result Treatment
Group results by repo, not only by chunk, in the default list mode.

Each repo row should show:
- repo identity,
- relevance score band,
- one best snippet,
- metadata badges,
- actions.

Secondary expandable section:
- `View 3 matching snippets`

#### Right Panel Tabs
1. Preview
- description, README excerpt, topics, language, stats, GitHub action

2. Why it matched
- top snippets,
- query term overlap highlights,
- dense/lexical rationale summary if available

3. Context
- add/remove snippets for chat
- show current context stack

### 5. Library Page
New page: `src/pages/app/LibraryPage.tsx`

#### Purpose
Support scanning and curation when the user does not have a query.

#### Layout
- top: page header + saved views + sort dropdown
- main: dense table/list
- right: repo preview panel

#### Default Saved Views
- All Repos
- Recently Synced
- Recently Updated
- TypeScript
- AI/ML
- Infra
- Needs Rediscovery

#### Quick Actions
- add tag
- add to context
- open on GitHub
- start search from repo
- filter by topic/language

### 6. Sessions Page
New page: `src/pages/app/SessionsPage.tsx`

#### Purpose
Turn sessions into a real knowledge trail.

#### Layout
- left: searchable session list
- main/right: selected transcript + attached result context

#### Session Row Fields
- title
- original query
- updated time
- repo count in context
- message count
- provider badge

#### Session Actions
- rename
- resume in Recall
- duplicate query into new session
- archive
- delete

### 7. Settings Page
New page: `src/pages/app/SettingsPage.tsx`

#### Section Order
1. GitHub Connection
2. Sync and Indexing
3. Embedding Engine
4. Chat Providers
5. Privacy and Permissions
6. Local Data
7. Developer

#### Important Rules
- move `OllamaConfigPanel` into `Embedding Engine`
- move `DeveloperModePanel` into `Developer`
- keep `Rebuild Embeddings` here or in `Sync Center`, not on the Recall page
- keep destructive actions visually isolated in `Local Data`

## Interaction and Micro-Interaction Improvements

### Fitts's Law
Apply by making the highest-value actions easier to hit.

Required changes:
- search input becomes full-width and primary,
- command palette trigger always visible,
- primary buttons minimum 40 px height,
- result row actions appear on hover/focus but retain keyboard access,
- tiny inline toggles replaced with readable pills or segmented controls.

### Hick's Law
Reduce choice overload by restructuring the first screen.

Required changes:
- only show search, recent activity, and sync health on the default ready state,
- move advanced settings out of Recall,
- show one recommended embedding path by default,
- collapse secondary provider details until chosen.

### Progressive Disclosure
Use staged complexity.

Examples:
- first-run setup shows `Recommended` engine by default; `Customize` reveals full controls,
- chat composer shows provider pill; full provider settings open in a sheet or settings page,
- result rows show summary first; details open in right panel,
- developer tuning remains behind `Developer mode` in Settings.

### Feedback Loops
Every expensive operation needs an immediate and calm feedback loop.

Required patterns:
- search: `Preparing query`, `Searching locally`, `Ready`
- sync: `Syncing stars`, `Fetching READMEs`, `Generating embeddings`, `Done`
- chat: `Preparing context`, `Streaming response`, `Complete`
- remote usage: inline disclosure before send

Feedback components:
- shell status pill,
- inline status note below search,
- progress bars only when a real background job is active,
- live region announcements for screen readers.

### Affordances and Micro-Interactions
Add small but meaningful behaviors:
- active result row gets a subtle left accent and surface lift,
- `Add to context` animates into the context tray,
- sync health dot pulses only while active,
- chat streaming uses restrained caret shimmer or token fade,
- keyboard shortcut hints fade in on focus/hover,
- list skeletons match final layout geometry.

## Accessibility Improvements

### Baseline Requirements
- target WCAG 2.2 AA minimum
- full keyboard accessibility for all primary flows
- no hover-only controls
- no 10 px critical text
- no color-only state communication

### Specific Improvements
1. Focus management
- add skip link to main content
- preserve focus on route transitions
- trap focus in command palette, dialogs, and sheets
- return focus to invoking control on close

2. Hit targets
- minimum interactive size 40 x 40
- filter chips minimum 32 px height, 40 px preferred on touch

3. Contrast
- increase contrast on muted text inside cards and chips
- ensure status pills meet contrast without relying on translucent fills alone

4. Screen reader semantics
- use `aria-live="polite"` for sync/search/chat progress states
- add labels for icon-only buttons
- mark selected result row with proper listbox/option or table row semantics

5. Motion and animation
- honor `prefers-reduced-motion`
- avoid long parallax or floating effects in app workspace

6. Input accessibility
- search supports label plus placeholder
- chat composer exposes keyboard hints in accessible text
- filters have visible labels in advanced filter drawer/sheet

### Accessibility-Specific Content Changes
- replace `sudo` label with `Developer mode` in user-facing UI; `sudo` can remain internal copy if desired but is not ideal accessibility copy
- move redirect URI out of the main login card body and into a help disclosure if it must remain visible

## Performance and Perceived-Speed Improvements

### Perceived-Speed Strategy
The UI should feel fast even when local compute is doing expensive work.

Required tactics:
- persistent app shell so only content panes change,
- instant palette open from in-memory index,
- skeletons for results, sessions, and detail panel,
- optimistic selection states,
- non-blocking background sync where possible,
- preserve previous results while a new search is running.

### Specific Improvements
1. Split operational work from visible UI work
- search UI should not clear the previous result set until the new set is ready
- sync progress should live in a compact shell indicator plus optional Sync Center

2. Introduce in-memory search indices for UI speed
- cache repo metadata for fuzzy palette search
- cache recent session metadata
- rebuild only after sync or tag edits

3. Virtualize larger lists
Apply virtualization for:
- repo library list/table
- sessions list
- long result lists if necessary

4. Reduce render churn
- memoize list rows and detail panes
- keep result selection and filter state local to the page domain
- avoid rerendering the whole app shell during sync progress updates

5. Preserve context
- remember last route and selected panel
- restore last active filters per page
- restore last open session where appropriate

6. Show meaningful placeholders
- repo preview skeleton should mirror real content blocks
- chat transcript skeleton should show message bubbles
- command palette can show recent actions instantly even before fuzzy index hydration completes

### Performance Acceptance Targets
- command palette opens in under 80 ms on warm state
- page-to-page navigation feels under 150 ms excluding heavy jobs
- first visible app shell appears before expensive sync telemetry loads
- result list remains interactive during background chat streaming

## Data and State Changes Needed for the Best UX
These changes are recommended because the target UX introduces tags, saved views, and explicit chat context.

### Existing Data Model Already Supports
Current local data already supports:
- repos
- chunks
- embeddings
- chat sessions
- chat messages
- index metadata

Files:
- `src/db/schema.ts`
- `src/db/client.ts`
- `src/db/types.ts`

### Recommended New Tables
Add only if implementing the full redesign, especially tags and explicit context editing.

#### 1. `repo_tags`
```sql
CREATE TABLE IF NOT EXISTS repo_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL
);
```

#### 2. `repo_tag_assignments`
```sql
CREATE TABLE IF NOT EXISTS repo_tag_assignments (
  repo_id INTEGER NOT NULL,
  tag_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, tag_id),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES repo_tags(id) ON DELETE CASCADE
);
```

#### 3. `session_context_items`
Use this if chat context should become first-class and editable across sessions.
```sql
CREATE TABLE IF NOT EXISTS session_context_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  repo_id INTEGER,
  chunk_id TEXT,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
```

#### 4. Optional `saved_views`
Useful for Library page presets.

### State Management Guidance
Do not add a global state library immediately.

Phase 1 recommendation:
- split `UsagePage` into feature hooks and route pages,
- keep state in React contexts/hooks,
- introduce a store only if the command palette and multi-pane selection model become painful.

## Frontend Implementation Guidance

### Required Refactor Direction
Break the current `UsagePage.tsx` into feature modules.

Recommended structure:
- `src/features/app-shell/AppShell.tsx`
- `src/features/app-shell/AppRail.tsx`
- `src/features/command/CommandPalette.tsx`
- `src/features/setup/SetupPage.tsx`
- `src/features/recall/RecallPage.tsx`
- `src/features/recall/ResultList.tsx`
- `src/features/recall/RepoDetailPanel.tsx`
- `src/features/recall/ContextTray.tsx`
- `src/features/library/LibraryPage.tsx`
- `src/features/sessions/SessionsPage.tsx`
- `src/features/settings/SettingsPage.tsx`
- `src/features/sync/SyncCenter.tsx`
- `src/features/search/useRecallController.ts`
- `src/features/chat/useChatController.ts`
- `src/features/sync/useSyncController.ts`

### Routing Guidance
Update `src/App.tsx` to use nested authenticated routes.

Suggested shape:
- `AppLayout` becomes public shell only or a thin global wrapper
- authenticated routes mount `AppShell`
- page-level routes map to `Recall`, `Library`, `Sessions`, `Settings`, `Setup`

### Styling Guidance
- move token definitions into `src/index.css`
- reduce one-off animation helpers
- prefer semantic utility classes via CSS variables over many per-component custom gradients
- unify surfaces and border treatments across pages

### Component Primitives to Add
Use shadcn CLI to add missing primitives. Do not install Radix packages directly.

Likely-needed primitives:
- `dialog`
- `command`
- `sheet`
- `tabs`
- `dropdown-menu`
- `breadcrumb`
- `toggle-group`
- `drawer` if mobile sheets need it and a suitable pattern exists in shadcn

### Search UX Implementation Notes
- keep semantic search as explicit submission to avoid expensive reruns on every keystroke
- use instant fuzzy suggestions before submission
- preserve prior result list until the new result list returns
- allow keyboard movement through results with `j/k` or arrows

### Chat UX Implementation Notes
- expose selected context count next to composer
- make provider choice readable without opening a tiny settings icon
- keep remote consent state persistent and visible
- show a compact `What will be sent` disclosure before first remote send

### Sync UX Implementation Notes
- `Sync Stars` should become a top-bar or command action, not a peer to the search button
- `SyncStatusBar` should be reworked into:
  - compact shell status,
  - expandable Sync Center,
  - setup progress view for first run

### Result UX Implementation Notes
- convert from cards-only to list-plus-detail on desktop
- retain cards only for compact/mobile or optional visual mode
- group by repo by default; snippets live inside detail panel or expandable row content

## Suggested Delivery Phases

### Phase 1: Foundation
- add design tokens
- create app shell
- split routes
- move settings out of Recall
- create Setup page

### Phase 2: Recall Workspace
- build omnibox
- build result list + detail panel
- build explicit context tray
- preserve current search backend behavior

### Phase 3: Command Interface
- add command palette
- add fuzzy repo/session/action search
- wire shortcuts and quick actions

### Phase 4: Library and Sessions
- add library page
- redesign sessions page
- improve session rename/resume/archive workflows

### Phase 5: Local Curation Features
- local tags
- saved views
- context persistence
- richer rediscovery actions

## Acceptance Criteria
The redesign is successful when all of the following are true:
- a new user can connect GitHub and understand the indexing process without reading docs
- a returning user can run a search or open the command palette within 2 seconds of landing in the app
- the main ready-state screen is search-oriented, not settings-oriented
- chat context is explicit and editable
- all major actions are keyboard-accessible
- sessions feel like saved investigations, not hidden side effects
- sync/indexing feedback is visible without dominating the workspace
- the UI reads as premium developer software instead of a debug control surface

## Review Checklist For The Implementing Agent
Before marking the redesign implementation complete, verify:
- routes are split and `UsagePage.tsx` no longer owns the whole product surface
- advanced runtime/provider controls are moved out of the default ready-state workspace
- `Cmd/Ctrl+K` works globally
- search, results, detail, and context all work with keyboard only
- text contrast and hit target sizing are improved across filters, sidebar items, and chat controls
- remote-provider disclosures are explicit and local-first copy remains clear
- mobile and desktop layouts both load and remain usable
- new primitives were added via shadcn CLI, not direct Radix installs
