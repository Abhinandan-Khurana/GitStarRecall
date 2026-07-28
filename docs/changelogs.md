# Changelogs

## 2026-07-28 (v0.14.0 - Public Launch Hardening)

Lean remediation program, PRs #46, #47, #54, #55, #56. Full mapping with commits and deferred work:
`docs/remediation/v0.14.0.md`.

Toolchain and CI (#46):

- Pinned supported runtimes: Node 22/24 via `engines`, pnpm 11.17.0 via `packageManager`, and an
  explicit dependency build allowlist.
- Added component and browser (Playwright) test harnesses, coverage and bundle-budget gates, and a
  reproducible Node 24 + Node 22 CI workflow with SHA-pinned actions and least-privilege permissions.
- Lint runs at `--max-warnings=0` with the baseline warnings removed.

Public launch boundary (#47):

- OAuth token exchange now enforces POST, a JSON content type, an 8 KiB body limit (413), exact field
  validation, a bounded upstream timeout, bounded error bodies, and `Cache-Control: no-store, private`.
- Added production security headers on Vercel: CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, and `X-Frame-Options: DENY`. CSP still allows `unsafe-eval`, which the
  in-browser model runtimes currently require.
- Replaced the catch-all SPA rewrite with explicit entry-route rewrites, so unknown paths return a
  real 404 instead of a 200 HTML shell.
- Fixed MIT attribution, corrected the favicon MIME declaration, published social/favicon assets
  under `public/static/`, removed an unreferenced 4.3 MB image, and dropped authenticated routes from
  the sitemap.

Sync, settings, and auth integrity (#54):

- README fetches distinguish 404 from transient failures: a transient failure preserves stored README
  bytes, validators, checksum, and chunks, then marks the repository for retry on the next sync.
- Retry waits are abortable and honor rate limits; star and fork counts refresh even when other
  repository metadata is unchanged.
- Provider settings hydrate asynchronously and persist through an invocation-ordered queue, so a save
  can no longer overwrite a stored encrypted key with a blank value; persistence failures are surfaced.
- OAuth callback exchange is single-flight and retryable, and retains its state/verifier until success
  or terminal validation failure.

Provider and worker reliability (#55):

- Generation executes against an immutable provider request config, including the fallback path, so a
  later render cannot change the endpoint mid-request.
- Hardened provider transport boundaries and stream finalization; suspended generations resume exactly
  once.
- Embedding workers recover from failed jobs, shared initialization failures, and queue drains.

Storage, privacy, and UX (#56):

- Workspace writes are serialized so the newest acknowledged mutation is the durable one.
- Chat backups, local logs, and deletion are scoped per authenticated identity: clearing one identity
  never touches another's records, logs are redacted and expired, and scoped clears fail closed rather
  than reporting success when a known storage backend cannot be written.
- Confirmed "Delete local data" surfaces enumerate every category, and legacy v1 chat records for the
  cleared identity are erased rather than only marked migrated.
- Enforced one current embedding per chunk with model/dimension readiness validation.
- Fixed command-palette parsing and shortcut handling, and made theme resolution tolerate unavailable
  browser storage.

Release slice (this PR):

- Authenticated app route pages load lazily behind an accessible Suspense boundary; `/` and
  `/auth/callback` stay eager.
- Lazy route failures preserve the app shell and expose an accessible reload action. The Setup, Recall, and
  Settings routes share the `UsagePage` chunk directly instead of loading three wrapper chunks first.
- Version metadata aligned to 0.14.0 (`package.json`, JSON-LD `softwareVersion`).
- Documentation corrected for supported runtimes, `pnpm dev` versus `vercel dev`, and the actual
  persistence/search architecture. The multi-tab storage trade-off is recorded in one focused ADR, and
  pre-implementation planning documents are marked historical.

## 2026-04-07 (Footer Redesign and Stacking Fix)

- Replaced the old card-style footer with a minimal two-column layout:
  - Left: brand lockup, tagline, "Source" and "Star on GitHub" pill buttons.
  - Right: categorized link columns — Resources (Usage Guide, Changelogs, All Docs) and Trust & Security (Security Policy, STRIDE Review, Code of Conduct).
  - Bottom strip: theme-native badge pills (Ask DeepWiki, MIT License, STRIDE Reviewed) replacing shields.io images, plus "Made with love by Abhinandan-Khurana" attribution.
- Fixed z-index stacking bug where the fixed hero background overlay (`position: fixed; inset: 0`) painted over all content below the hero. Added `relative z-10` to `LandingConnectSection`, `LandingWorkspaceFlow`, and the footer.

## 2026-04-07 (Landing UX Overhaul and App Onboarding)

- Restructured the landing page to eliminate conversion friction (auth was 3-4 viewports below the hero CTA):
  - Hero now contains a direct "Continue with GitHub" OAuth button as the primary CTA. Authenticated users see "Open app" instead.
  - "Use a PAT instead" secondary CTA scrolls to a compact auth section one viewport below.
  - Added a trust badge ("Read-only access. No write scope.") under the headline on all viewports.
  - Navbar "Get started" button now triggers OAuth directly when logged out.
  - Removed the scroll indicator (Scroll + ChevronDown) from the hero.
  - Reduced mobile hero proof cards from 3 to 2 (dropped "Read-only GitHub access" card; messaging moved to trust badge and compact auth).
- Compact Auth Section replaces the heavy two-column `Connect your stars` layout:
  - Single centered card (`max-w-3xl`) with OAuth and PAT side-by-side.
  - Removed left column (Permission note, Read-only explainer, What happens next bullets).
  - Single trust line with lock icon below the cards replaces three prior instances of read-only messaging.
- Removed `LandingValueRail` (5-view interactive showcase) from the landing page. The interactive workspace preview is now in the authenticated app.
- Simplified `LandingWorkspaceFlow` into a lean static "How it works" section:
  - Removed `useParallaxProgress` hook, outer card wrapper, header grid, sidebar box, and watermark step numbers.
  - Clean horizontal 3-step layout with section title "How it works".
- Upgraded landing footer with links to Usage Docs, Changelog, Security, and MIT License line.
- App onboarding improvements:
  - First-time users (`repoCount === 0`) are auto-navigated from `/app` to `/app/setup` with a loading spinner while the DB resolves.
  - Added `OnboardingStepper` component: horizontal 3-step progress indicator (Connect / Index / Search) shown at top of AppHomePage when indexing is incomplete.
  - Added `WorkspaceGuide` component: interactive 5-view workspace preview (extracted from LandingValueRail, stripped of parallax/scroll-reveal), integrated as a collapsible "Explore workspace views" section on AppHomePage for returning users. Dismiss state persisted in localStorage.
- Fixed AppShell header and sidebar brand links from `/` to `/app` so clicking the brand navigates to the app home instead of the marketing landing page.
- New files: `src/components/app/OnboardingStepper.tsx`, `src/components/app/WorkspaceGuide.tsx`.
- Landing page target flow: Hero (OAuth inline) → Compact Auth (one scroll) → How It Works → Footer.

## 2026-04-07 (Midnight Minimal UI Overhaul)

- Redesigned the full landing page and app shell with a new "Midnight Minimal" design system:
  - Near-black cool-toned base (`hsl(240 10% 5%)`) with hot coral accent (`hsl(8 85% 58%)`).
  - Both dark and light themes are equally polished; light theme uses a cool gray base with deeper coral for contrast.
- Replaced `@paper-design/shaders-react` shader background with a CSS-only atmospheric gradient using multiple overlapping radial gradients and a slow ambient drift animation (Raycast-inspired).
- Swapped font stack to Bricolage Grotesque (display), Outfit (body), and JetBrains Mono (code).
- Removed pervasive glassmorphism (backdrop-blur + translucent backgrounds) from cards, sections, and controls; replaced with solid card surfaces using `--card` / `--muted` tokens and subtle `--border` outlines. Glass retained only on the hero navbar.
- Added `useRevealOnScroll` hook (IntersectionObserver-based) for scroll-triggered entrance animations on ConnectSection, ValueRail, and WorkspaceFlow.
- Refined hero entrance animations to use cinematic `cubic-bezier(0.22, 1, 0.36, 1)` curves at 0.8s duration; reduced float-cloud drift to 3-5px over 6-8s for subtler ambient motion.
- Added scroll-aware navbar that transitions from transparent to solid on scroll.
- Added scroll-down indicator in hero section.
- Tightened spacing across landing sections, footer, and app shell; added typographic step numbers as visual anchors in WorkspaceFlow.
- Updated app shell sidebar with active nav indicator (2px coral left border) and entrance stagger on AppHomePage.
- All animations respect `prefers-reduced-motion`.

## 2026-04-07 (Public-Repo-Only Access Policy)

- Removed private-repository access across OAuth behavior, runtime sync, and product messaging.
- OAuth now requests only `read:user` (removed `repo` scope from authorize configuration).
- Star sync now enforces public-only ingestion by filtering out private repositories before indexing and README fetch.
- Updated landing/auth copy and security/product docs to consistently describe public-repo read-only behavior.
- Added OAuth scope regression coverage and public-filtering test coverage in GitHub client tests.

## 2026-03-09 (Migration Recovery Edge Cases)

- Hardened the stable-scope migration paths for two low-frequency but high-impact recovery cases.
- Encrypted provider settings migration now fails closed:
  - if a legacy token-scoped settings record contains an encrypted API key but `VITE_LLM_SETTINGS_ENCRYPTION_KEY` or Web Crypto support is unavailable, the app now preserves the legacy record and surfaces the migration failure instead of silently copying unusable ciphertext into the new account scope.
  - if a legacy token-scoped settings record is malformed JSON, the app now discards that unreadable historical record instead of re-throwing the parse failure on every login.
- Legacy DB migration now recovers from unreadable historical snapshots:
  - if a legacy token-scoped SQLite snapshot is unreadable during one-time migration, the app now discards only that unreadable legacy copy and continues login with a fresh stable account scope instead of permanently blocking future logins.
- Updated `docs/Usage.md`, `docs/security-review-stride.md`, and `docs/threat-modeling-stride.md` to document the env-secret requirement for encrypted provider-key migration and the unreadable-legacy-snapshot recovery path.

## 2026-03-09 (Persistence Hardening Follow-up)

- Closed review-discovered persistence gaps in the new GitHub-account-scoped storage model.
- Hardened logout/reset semantics:
  - `Clear token` now removes only the in-memory GitHub credential,
  - account-scoped provider/model/API-key settings remain available when the same GitHub account signs back in,
  - destructive local-state removal stays behind `Delete local data`.
- Hardened account-scoped settings persistence:
  - sync settings loading now still reports encrypted API-key-backed configurations as configured,
  - stable account-scoped settings keys now use a distinct namespace with compatibility for already-written hashed scope records,
  - legacy encrypted settings migration now fails loudly instead of silently stranding or dropping API keys.
- Hardened local DB scope migration:
  - migration now compares persisted snapshot freshness before preferring OPFS vs local-storage copies,
  - stale legacy snapshots are cleaned up even when the stable target already exists,
  - non-recoverable migration failures still surface as blocking errors instead of silently opening a fresh empty scope.
- Updated `docs/Usage.md`, `docs/security-review-stride.md`, `docs/threat-modeling-stride.md`, and `docs/tech-stack-architecture-security-prd.md` to match the shipped logout and local-data semantics.

## 2026-03-09 (Auth Persistence Across OAuth/PAT Re-login)

- Fixed browser-local data appearing to disappear after refresh + re-login with OAuth or PAT.
- Root cause:
  - local persistence had been scoped by auth token hash, so a rotated OAuth token or a different PAT for the same GitHub account opened a different local scope.
- Updated auth persistence to use a stable GitHub account identity instead:
  - local SQLite/OPFS/localStorage database scope now follows the authenticated GitHub user rather than the current credential string,
  - chat/session scope and provider-setting scope now follow the same stable account identity,
  - legacy token-scoped local DB/settings data is migrated forward on login so existing browser-local data is not stranded.
- This preserves cross-account isolation while keeping one user’s local workspace stable across refreshes, OAuth token rotation, and PAT re-entry.

## 2026-03-09 (`release-notes.md` renamed to `changelogs.md`)

- Renamed the project changelog document from `docs/release-notes.md` to `docs/changelogs.md`.
- Future documentation updates and release-history entries should now target `docs/changelogs.md`.

## 2026-03-09 (Security STRIDE / Threat Model Refresh)

- Refreshed the security STRIDE review and threat model docs against the current code and the latest auth/security release deltas:
  - added GitHub token-normalization coverage for OAuth and PAT flows,
  - documented the corrected 401 guidance around invalid/expired/revoked or incorrectly pasted tokens,
  - recorded the shipped remote-provider disclosure and local-data reset semantics, including WebLLM/model cache cleanup.
- Aligned related user-facing docs with the current auth behavior:
  - `docs/Usage.md` now explains PAT wrapper normalization and current 401 troubleshooting guidance,
  - `README.md` now describes OAuth/PAT as read-only access paths for authorized public repositories.

## 2026-03-09 (SessionChat provider label button fix)

- SessionChat model-settings trigger button: replaced the ghost `<Button>` used as the provider label with a plain `<span>`, so the label no longer renders as an interactive control or shows a ghost-button hover highlight.

## 2026-03-08 (GitHub Auth 401 Fix and Token Normalization)

- Hardened GitHub auth token handling for both OAuth tokens and pasted PATs:
  - shared token normalization now strips accidental `Bearer` / `token` prefixes, surrounding quotes, and extra whitespace before the token is stored or reused,
  - reduces avoidable authorization failures when users paste tokens copied from shells, headers, or quoted env values.
- Standardized GitHub API authorization behavior around normalized raw tokens and `Bearer` request headers so login/import flows consistently send the expected credential format.
- Improved the GitHub 401 error guidance shown to users:
  - the message now focuses on invalid, expired, revoked, or incorrectly pasted tokens,
  - removes the misleading implication that extra GitHub scopes are the main fix for starred-repo access failures.

## 2026-03-08 (Landing Hero Polish, Navbar Restore, and Motion Follow-ups)

- Refined the landing hero after the initial parallax redesign with a more structured composition across desktop, tablet, and mobile breakpoints:
  - desktop restores a more editorial hero layout with floating support cards around the main value proposition,
  - tablet/mobile keep the same proof points in a denser stacked/grid composition instead of hiding them behind large-screen-only placement.
- Restored the upgraded landing navbar from the UI revamp branch:
  - the hero now uses the branded top bar with source access, theme toggle, and primary CTA,
  - the navbar remains visually integrated with the shader-backed hero instead of falling back to the earlier simpler inline header.
- Added and tuned richer hero motion:
  - staggered entrance animations for headline, supporting copy, proof cards, and CTA row,
  - cloud-like floating card motion and hover lift for the hero proof blocks.
- Fixed landing hero motion regressions discovered during review:
  - delayed entrance animations now use fill behavior that applies the hidden start state during the delay window, avoiding a visible flash before the fade/slide begins,
  - continuous float motion now runs on a separate wrapper layer from entrance motion, so cards continue drifting after they enter instead of freezing,
  - background/supporting hero cards keep their intended reduced-opacity hierarchy after the entrance animation completes.
- Added small UX/accessibility/stability follow-ups around the landing refresh:
  - improved responsiveness and spacing for the hero and workflow sections,
  - added missing `aria-label` coverage for landing hero button actions,
  - cleaned up hero component structure/types and fixed the JSX regression introduced during the refactor.

## 2026-03-08 (Dead Code Cleanup and Dependency Prune)

- Removed unused code paths that had no live in-repo reachability from the current app entrypoints:
  - orphaned shadcn UI wrappers for avatar, breadcrumb, dropdown menu, skeleton, tabs, toggle, and toggle group,
  - unused `AppStateRedirect` route helper that was no longer wired into routing,
  - legacy `NativeEmbeddingClient` path and its isolated test, after Ollama/browser embedding paths became the only supported runtime backends.
- Pruned now-unused package dependencies introduced only for those deleted UI wrappers:
  - `@radix-ui/react-dropdown-menu`
  - `@radix-ui/react-tabs`
  - `@radix-ui/react-toggle`
  - `@radix-ui/react-toggle-group`
- Re-ran repository-wide reachability checks from `src/main.tsx`, then verified the cleaned tree with lint, tests, and production build.

## 2026-03-08 (Landing Page Parallax Redesign and Public Auth Flow Refresh)

- Rebuilt the public landing page into a parallax-first product narrative instead of a static two-column auth-first layout.
- Added a shader-backed hero with layered motion and a lower auth entry point:
  - `Get started` now scrolls to the lower `Connect your stars` section,
  - `See the workspace flow` jumps to the product journey block,
  - the landing page now keeps the main product promise and workflow explanation above the auth form.
- Replaced the static `What you get after login` cards with an animated interactive walkthrough of:
  - Home,
  - Recall,
  - Library,
  - Sessions,
  - Settings.
- Added explicit trust copy on the landing/auth surface:
  - GitHub OAuth is presented as a read-only path for reading public repositories,
  - PAT is documented with the same read-only public repository intent.
- Repositioned the auth experience so `Connect your stars` feels like the landing conclusion instead of competing with the hero.
- Installed `@paper-design/shaders-react` for the landing shader background.
- Attempted the requested shadcn Marshmallow theme install via:
  - `pnpm dlx shadcn@latest add @ss-themes/marshmallow`
- The remote registry required auth, so the shipped fallback uses a local Marshmallow-style token layer in `src/index.css` instead of the remote theme payload.

## 2026-03-08 (Workspace Shell, Route Split, and Auth-Scoped Local State)

- Reworked the authenticated app from a single overloaded `/app` page into a route-based workspace:
  - `/app` is now a dedicated workspace home/launch surface,
  - `/app/setup` for first-run indexing,
  - `/app/recall` for search and chat,
  - `/app/library` for repo browsing,
  - `/app/sessions` for transcript/history review,
  - `/app/settings` for sync, providers, privacy, and local data.
- Added a persistent app shell with:
  - workspace health summary,
  - nav rail,
  - keyboard shortcuts,
  - command palette (`Cmd/Ctrl+K`),
  - quick route switching (`G` then `R` / `L` / `S`).
- Rebuilt the landing and auth callback flow to match the productized workspace:
  - PAT fallback stays visible on the landing page,
  - callback page now shows staged auth progress before redirecting into the app shell.
- Added standalone `Library` and `Sessions` views so repo browsing and transcript review no longer compete with the main Recall surface.
- Split setup/settings concerns out of the main Recall canvas:
  - setup now guides import -> README fetch -> embedding generation,
  - settings owns embedding runtime, provider defaults, developer retrieval tuning, privacy, and local data controls.
- Extracted shared provider configuration UI into `ProviderSettingsForm` so chat/settings configuration paths stay aligned.
- Hardened local-state isolation across identities:
  - initial local SQLite/OPFS/localStorage database names were scoped by auth token hash in that rollout and were later migrated to stable GitHub-account identity scope on 2026-03-09,
  - auth-scoped helpers now isolate chat/session continuity and embedding preference keys,
  - added scope regression tests for auth helpers and DB naming.
- Expanded local schema support for future workspace features:
  - added `repo_tags`,
  - added `repo_tag_assignments`,
  - added `session_context_items`.

## 2026-03-08 (Sync Status Semantics and Embedding Progress Simplification)

- Replaced phase-string-driven sync progress inference with explicit runtime status fields.
- Fixed first-sync copy so initial indexing no longer says `changed repositories`:
  - first sync now uses labels like `Fetching READMEs for starred repositories` and `Chunking repositories`,
  - incremental sync uses `new or updated` / `updated repositories` wording only when local state already exists.
- Fixed chunking progress publication so chunking counts advance as chunk upserts complete, not after a later embedding window returns.
- Kept staged overlap behavior, but changed the status bar to reflect live work correctly:
  - once embeddings start, embedding becomes the primary active stage,
  - unfinished chunking remains visible as secondary work instead of hijacking the main label.
- Added explicit handling for windowed incremental embedding runs so the UI no longer treats the window cap as the total backlog.
- Simplified active embedding UX after multiple follow-ups:
  - active embedding generation now shows an indeterminate `Embedding in progress` loader,
  - removed moving ETA/progress math from the embedding row,
  - added a concise timing note for large libraries instead of unstable batch-based countdowns.
- Added focused regression coverage for sync-stage derivation, first-sync labeling, overlap handling, and sync-status rendering.

## 2026-03-05 (Usage Settings UI Follow-up Fixes)

- Completed the developer retrieval-tuning panel so all persisted knobs are editable in UI:
  - `lexicalTop1Threshold` (`0.05..0.5`)
  - `lexicalTop5MeanThreshold` (`0.05..0.5`)
- Improved tuning input UX for numeric controls:
  - tuning fields now keep draft text while typing and only commit on blur/Enter,
  - prevents immediate min-clamp overwrite on intermediate keystrokes (for example `fetchK`, `topK`).
- Aligned UI diversity warning with backend retrieval normalization:
  - `fetchK` warning now triggers when `fetchK < topK * 6`.
- Fixed stale rebuild confirmation state in developer mode:
  - turning off `Enable developer advanced mode` now clears the pending `Are you sure?` state for `Rebuild Embeddings`.
- Removed duplicate rebuild confirmation during panel-triggered rebuild:
  - `DeveloperModePanel` confirmation is now the single prompt path.
- Decoupled rebuild loading state from star-sync loading state:
  - rebuild button/spinner state now tracks embedding rebuild only, not general `Fetch Stars`.
- Added accessibility semantics for disclosure-style controls:
  - advanced tuning toggle and browser capability toggle now expose `aria-expanded`/`aria-controls`,
  - custom model input now has an explicit associated label.
- Fixed custom-model selection edge case in Ollama embedding settings:
  - selecting `Custom model...` no longer forces a fallback model when the input is blank,
  - prevents custom input from collapsing immediately when common defaults are installed locally.
- Narrowed `ollamaConnectionStatus` typing in `OllamaConfigPanel` from loose `string` to the explicit status union (`idle|testing|connected|failed|inactive`) for stronger compile-time safety.
- Ollama empty-model guidance now respects toggle state:
  - "No embedding models detected" is shown only when Ollama embedding mode is enabled.
- Removed duplicate `RetrievalTuning` type declarations by importing the shared type from `DeveloperModePanel` into `UsagePage`, preventing silent type drift.
- Synced docs for these controls in `docs/Usage.md`.

## 2026-03-05 (Sync Progress UX Fix - README + Ollama Embeddings)

- Fixed sync progress visibility during staged indexing:
  - README progress now remains visible during active README work even when incremental embedding metrics are present.
  - Embedding initialization now renders an indeterminate animated progress bar until a concrete embedding target is known.
  - Embedding progress automatically switches to determinate (`completed/target`) once chunk targets are available.
- Added progress-state regression coverage in `src/components/SyncStatusBar.test.ts`.

## 2026-03-05 (Remaining Concerns Follow-up - Score Display + Pooling Verification)

- Search result score display now clamps negative rerank values to `0.000` in UI for readability (ranking/order unchanged).
- Browser embedding pooling strategy is now explicit and centralized:
  - `embeddinggemma` uses `mean` pooling with source-backed rationale from Hugging Face Text Embeddings Inference guidance.
  - fallback/default remains `mean` for current browser embedding candidates.
- Search diagnostics signal is now less ambiguous:
  - `denseSuspicious` reports dense-confidence concerns (`low_top1`, `low_top5_mean`, `low_repo_diversity`),
  - `lexicalTriggered` still reports whether lexical safety-net executed (including rare-token triggers).
- Rare-token lexical trigger now has a confidence/alignment bypass:
  - lexical safety-net is skipped when dense top-1 is highly confident _and_ lexically aligned with the rare-token query,
  - lexical safety-net still runs for high-confidence but lexically mismatched dense top-1 results.
- Qwen3 retrieval prompting now follows model-card format:
  - queries use `Instruct: ...` + `Query: ...`,
  - passages/documents are embedded as raw text (no `passage:` prefix).
- Lexical broad sampling now targets the corpus interior slice first (excluding oldest/newest windows) to reduce overlap and improve unique lexical candidate coverage.
- Curated embedding warning logic now matches retrieval-profile model families (for example `mxbai-embed`_, `nomic-embed`_) to avoid false custom-model warnings on valid variants.
- `Rebuild Embeddings` now requires explicit user confirmation before clearing and regenerating the embedding index.
- README section splitting for large-readme chunking is now code-fence-aware, so heading-like lines inside fenced code blocks do not create artificial section boundaries.
- Chunk budgeting for large READMEs now intentionally under-fills when fewer than 120 windows clear the quality floor (no low-quality padding fallback).
- Pooling profile resolution now inspects model identity and emits a one-time warning for unknown model families before using mean pooling fallback.
- Verified dependency concern: `@huggingface/transformers@3.8.1` currently pulls `onnxruntime-node` and `sharp` as required transitive dependencies; tracked as a portability/CI risk pending upstream or package-level mitigation.

## 2026-03-05 (Minor PR Review Remediation - CSP + Model Warning + Ollama Order)

- Tightened CSP `script-src` allowance for transformers runtime script loading:
  - replaced broad `https://cdn.jsdelivr.net` host allowance with a pinned transformers dist path (`@huggingface/transformers@<resolved-version>/dist/`).
- Fixed curated custom-model warning regression:
  - `nomic-embed-text` now treated as curated/supported in embedding warning logic.
  - curated checks now support tagged model forms (e.g. `:latest`) for supported families.
- Removed dead `embeddinggemma` entry from Ollama embedding recommendation order.
- Improved Ollama embedding recommendation matching to support tagged model names (prefix match for curated defaults).
- Added model-catalog regression test for tagged embedding model names.

## 2026-03-05 (Docs + Retrieval Follow-up Alignment)

- Updated retrieval/chunking notes to match latest behavior:
  - large-README chunk budget quality scoring now evaluates normalized window text before budget selection,
  - lexical safety-net fused candidates now carry fused relevance into MMR reranking (lexical-only candidates no longer enter rerank as hard-zero relevance).

## 2026-03-05 (Follow-up PR Review Fixes - Model Routing + Capability + Chunk Budget)

- Fixed browser capability scoring so `perfScore == null` is neutral (`+0`), preventing weak/timeout devices from receiving an unintended heavy-model boost.
- Fixed embedding backend routing heuristic:
  - removed slash-based browser detection,
  - now routes browser embeddings only for explicit browser model prefixes (`onnx-community/`, `xenova/`),
  - prevents namespaced Ollama models (`myorg/custom-embed:latest`) from being misrouted to browser runtime.
- Fixed chunk budgeting quality gate:
  - removed unconditional inclusion of first 3 windows,
  - all windows now pass through quality selection.
- Added regression coverage:
  - `src/embeddings/modelRouting.test.ts`
  - `src/embeddings/browserCapability.test.ts` (null perf signal)
  - `src/chunking/chunker.test.ts` (first-window quality bypass)

## 2026-03-05 (PR Review Remediation - Search Correctness and Stability)

- Fixed critical dense cosine bug in `src/db/client.ts` where zero-norm vectors could produce `NaN` and corrupt ranking order.
- Added shared safe cosine utility and aligned search/rerank vector math behavior.
- Updated lexical safety-net policy:
  - tiny-corpus + high-confidence dense results now skip lexical branch (lower onboarding latency),
  - lexical candidate pool now combines recent + oldest + broad deterministic coverage (removes recency-only bias).
- Added/expanded retrieval diagnostics:
  - `denseNaNClampedCount`
  - lexical pool composition counters
  - corpus counters
  - rerank vector mismatch counters
- Fixed browser embedding capability scoring so unknown `deviceMemory` is neutral (no positive boost).
- Updated chunk budgeting flow so quality scoring runs on normalized windows before final chunk selection.
- Deduplicated query tokens in lexical overlap and rare-token counting.
- Hardened rerank behavior for vector-size mismatch (no full-pass hard fail).
- Rerank output now preserves both MMR ranking score (`score`) and rerank relevance signal (`denseScore`).

## 2026-03-05 (Browser Embedding Capability UX + Advanced Tuning Visibility)

- Browser embedding recommendation is now capability-driven:
  - strong desktop + WebGPU -> `onnx-community/embeddinggemma-300m-ONNX`
  - mobile / weak / no-WebGPU / probe-failed -> `Xenova/all-MiniLM-L6-v2`
- Browser capability test results are now shown in Embedding settings (reason, cores, RAM hint, perf score when available).
- Search/embedder worker now reuses capability-ordered model candidates, preventing unnecessary model re-download churn from candidate-order drift.
- Developer advanced mode (`sudo`) is now a visible UI checkbox (not hidden-only), with:
  - red warning about quality/speed/efficiency tradeoffs
  - scoped persistence (`gitstarrecall.sudo.<scope>`)
  - `Rebuild Embeddings` action to regenerate vectors with updated settings.
- Updated CSP `script-src` allowlist to include `https://cdn.jsdelivr.net` for runtime ORT JSEP module loading used by browser embeddings.
- Browser embedding runtime now uses `@huggingface/transformers` package path.

## 2026-03-05 (Semantic Retrieval v2 + Model Policy Refresh)

- Search pipeline upgraded to retrieval v2:
  - dense candidate fetch (`fetchK`)
  - dense confidence gate
  - lexical safety-net branch (conditional only)
  - RRF fusion (conditional)
  - MMR rerank + per-repo cap
- Added strict embedding dimension compatibility checks during search (no silent zero-score fallback).
- Added retrieval diagnostics payload (`queryDim`, sampled index dims, trigger reason, dense top scores).
- Browser embedding baseline switched to `embeddinggemma` (later superseded by capability-driven recommendation policy in the same release cycle).
- Ollama embedding recommendations now prioritize:
  1. `qwen3-embedding:4b`
  2. `qwen3-embedding:0.6b`
  3. `mxbai-embed-large`
- Custom embedding model path now shows warning because tuned retrieval assumptions may not hold.
- Added advanced retrieval tuning controls for sudo mode (`fetchK`, `topK`, `mmrLambda`, `maxChunksPerRepo`, lexical thresholds).
- Updated docs and DFD Mermaid diagrams to reflect retrieval v2 architecture and threat-model deltas.

## 2026-03-04 (Ollama Model Discovery + UI Selection)

- Removed env-coupled embedding model selection from runtime (`VITE_OLLAMA_MODEL` is no longer used by app flow).
- Added baseline Ollama embedding default of `nomic-embed-text` when no user preference exists.
- Added automatic local model catalog discovery from Ollama (`GET /api/tags`) with typed parsing/classification:
  - embedding-capable model list
  - chat/LLM model list
- Added embedding settings dropdown backed by discovered embedding models, with custom model override.
- Added chat settings Ollama dropdown backed by discovered LLM models, with custom model override.
- Added auto-selection policy:
  - prefer last-used model if still installed
  - otherwise use recommended default
  - then first available model
- Expanded connection diagnostics for unreachable/CORS/timeouts with actionable remediation:
  - run `ollama serve`
  - set global CORS `OLLAMA_ORIGINS=\"*\"`
  - retry connection test
- Added new model catalog tests in `src/ollama/modelCatalog.test.ts`.
- Updated docs/env guidance to remove `VITE_OLLAMA_MODEL` references and document UI-first model selection.

## 2026-02-24 (WebLLM Recommendation Calibration for macOS/Desktop)

- Fixed WebLLM model recommendation logic that could incorrectly classify strong Mac desktops as weak when memory hints were unavailable.
- Replaced strict hard-gate recommendation with score-based desktop strength evaluation using:
  - hardware concurrency
  - memory hint (neutral when unavailable)
  - perf probe (neutral when unavailable)
- Preserved hard fallback semantics for `mobile` and `no-webgpu` paths.
- Added anti-flap behavior near threshold to avoid unstable strong/weak recommendation flipping.
- Added recommendation diagnostics in chat UI (`reason`, `webgpu`, `cores`, `mem`, `perf`) for explainability.
- Added expanded tests in `src/llm/webllm/capability.test.ts` covering macOS-like and boundary scenarios.

## 2026-02-24 (WebLLM Browser LLM Integration)

- Added feature-flagged Browser WebLLM provider (`VITE_WEBLLM_ENABLED=1`) in the LLM provider stack.
- Added explicit consent-first model download flow:
  - generation blocks until user confirms download
  - no implicit model download before consent
  - runtime progress/status is shown in UI
- Added adaptive model recommendation and defaults:
  - strong desktop -> `Llama-3.2-1B-Instruct-q4f16_1-MLC`
  - mobile/weak/no-WebGPU -> `SmolLM2-360M-Instruct-q4f16_1-MLC`
- Added six selectable WebLLM models in catalog:
  - Llama 3.2 1B, SmolLM2 360M, Qwen2.5 1.5B, Gemma 2 2B, Hermes 3 Llama 3 3B, Llama 3.1 3B.
- Added Hermes compatibility substitution (`Hermes-3-Llama-3-3B...` -> `Llama-3.1-3B...`) when needed.
- Added typed WebLLM runtime errors and user-facing mapping for unsupported/download/init/stream failures.
- Added deterministic provider fallback resolver and tests for fallback order:
  - `webllm -> ollama -> lmstudio -> openai-compatible`.
- Added WebLLM cache cleanup in local data delete flow.
- Added tests:
  - `src/llm/webllm/modelCatalog.test.ts`
  - `src/llm/webllm/capability.test.ts`
  - `src/llm/fallback.test.ts`
  - `src/lib/settings.test.ts`
- Added CSP `connect-src` host allowances required for WebLLM model artifact download paths.

## 2026-02-23 (README Batch Pipeline v2 + Incremental Sync)

- Added feature-flagged staged sync pipeline (`VITE_README_BATCH_PIPELINE_V2`) for large star libraries.
- README ingestion now supports adaptive concurrency with retry/rate-limit telemetry and cooldown downshift.
- Added conditional README revalidation support and persisted validators:
  - new repo fields: `readme_etag`, `readme_last_modified`
  - request headers: `If-None-Match`, `If-Modified-Since`
  - `304 Not Modified` path reuses previously indexed README checksum/content metadata.
- Added mini-batch README processing callbacks to overlap README fetch with chunk upserts.
- Added rolling embedding windows during sync (`VITE_EMBED_TRIGGER_THRESHOLD`, `VITE_EMBED_WINDOW_SIZE`) so first embeddings can appear before full README completion.
- Persisted pipeline metrics in `index_meta` under `last_star_sync_pipeline_metrics` (star fetch time, README stage time, p95 README latency, first embedding timing).
- Added/updated tests for new README client behavior:
  - conditional revalidation
  - batch callback execution

## 2026-02-23 (Search Uses Existing Local Index Only)

- Removed automatic star refresh from search execution flow.
- Search now runs only on currently indexed local embeddings for predictable latency on large libraries.
- Star/README sync and embedding updates now happen only when user explicitly clicks `Fetch Stars`.
- Added in-app guidance text near search: to query latest stars, run `Fetch Stars` first.

## 2026-02-23 (Ollama Embedding UI-First Integration)

- Replaced generic native embedding runtime path in app flow with dedicated Ollama embedding client integration:
  - health/model probe via `GET /api/tags`
  - embedding endpoint detection (`/api/embed` with `/api/embeddings` fallback)
  - strict localhost-only endpoint allowlist enforcement
- Added authenticated UI controls for Ollama embedding:
  - explicit opt-in toggle (default OFF per auth identity)
  - editable Ollama base URL + model inputs
  - `Test connection` action with runtime status messaging
- Added scope-aware preference persistence for Ollama consent/settings using token-hash keyed localStorage entries.
- Added embedding model/backend isolation:
  - `index_meta` now tracks `embedding_active_backend` and `embedding_active_model`
  - embeddings are reset if active backend/model changes to prevent mixed-model vector stores
- Added deterministic failure handling for mid-run Ollama outages:
  - if Ollama batch embedding fails, run restarts on browser embedding backend
  - status is surfaced in UI and local diagnostics
- Updated query embedding path to honor active embedding backend metadata so search/query vectors stay aligned with indexed vectors.
- Added/updated tests:
  - `src/embeddings/ollamaClient.test.ts`
  - `src/db/client.embedding-queue.test.ts`

## 2026-02-23 (Embedding Pipeline v2)

- Reworked embedding generation to a queue-materialized pipeline:
  - pending chunks are loaded once per run (`listPendingChunksForEmbedding`)
  - hot-loop `CAST` joins were removed from pending-chunk SQL paths
  - added DB indexes for `chunks(created_at)` and `embeddings(chunk_id)`
- Added true batched worker inference path with robust output-shape normalization and per-item fallback.
- Added adaptive batch tuning and character-budget guard in the embedding loop.
- Decoupled embedding compute from DB writes:
  - embeddings are buffered and flushed in larger write batches
  - checkpoint policy remains active with final forced flush
- Throttled indexing UI updates to reduce main-thread pressure while preserving terminal-state updates.
- Added large-library mode (`>500` repos by default):
  - priority scoring uses stars, recency, and README availability
  - resume cursor persisted via `index_meta` (`embedding_job_cursor` and related keys)
- Added initial opt-in local embedding client path with localhost-only endpoint validation (legacy path later superseded by dedicated Ollama integration):
  - runtime probe endpoint (`/v1/runtime`)
  - batch embedding endpoint (`/v1/embeddings`)
  - automatic fallback to browser path on batch failure
- Added explicit user consent toggle for local embeddings in UI.
- Added new tests:
  - `src/db/client.embedding-queue.test.ts`

## 2026-02-23 (Chat History Isolation + Restore Race Fix)

- Fixed cross-PAT chat history bleed by scoping chat sessions to the active auth token scope:
  - new sessions are created with scoped IDs (`chat:<scope>:<uuid>`)
  - history restore now filters both SQLite and backup snapshots by active scope
  - on auth scope change, in-memory sessions/messages are cleared and restored only for the new scope
- Hardened backup rehydrate path to import only scoped backup sessions/messages into SQLite.
- Fixed first-search empty-session bug caused by async restore clobbering in-memory search results:
  - restore apply now merges with current in-memory state
  - non-empty in-memory session results are preserved
  - active session selection is stabilized during restore merges

## 2026-02-23

- Fixed disappearing chat history after refresh by adding resilient chat backup storage:
  - primary backup in IndexedDB
  - fallback backup in localStorage when IndexedDB is unavailable
- Wired backup writes into chat persistence paths (`upsertChatSession`, `addChatMessage`) so backup is updated even if primary DB persistence later fails.
- Added restore fallback in Usage page: if SQLite/OPFS history is empty or restore fails, chat sessions/messages are recovered from backup.
- Added restore-source visibility in UI (`sqlite`, `indexeddb`, or `local-storage`) for diagnostics.
- Updated clear-data behavior to wipe chat backup copies along with local DB storage.
- Added tests for chat backup fallback/pruning/clear behavior.

## 2026-02-22

- Fixed chat history restore after refresh + PAT re-auth by rerunning deterministic local restore on auth transition.
- Added explicit history restore state in UI and persisted `history_last_restored_at` metadata.
- Clarified restored-history vs in-memory retrieval context behavior and added one-click rehydrate action for empty in-memory results.
- Persisted minimal retrieval context IDs per session (`session_context_ids:<sessionId>`) for continuity/debugging.
- Consolidated Vite config usage to `vite.config.ts` and prevented `vite.config.js` drift.
