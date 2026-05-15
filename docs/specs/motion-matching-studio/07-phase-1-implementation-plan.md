# MotionMatching Studio Phase 1 Implementation Plan

Created: 2026-05-14

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable MotionMatching Studio milestone: open the Studio in Codex/browser dev mode, create/open the browser workspace, upload the local Iyo Visual FBX as a character, generate a preview GLB/cache, show the character in the left tree, render the skinned mesh in the Babylon viewport, and show character validation in the inspector.

**Architecture:** Phase 1 establishes the web-first tool shell and the Visual FBX import/render path only. The backend is ASP.NET Core on .NET 8 with filesystem JSON manifests under a repo-local `.motionstudio/browser-workspace/`; the frontend is Vite + React + TypeScript with Babylon.js. Animation clips, motion database build, Play Mode, retargeting, and Unity export are intentionally out of scope for this phase.

---

## Research Findings

- There is no existing Studio app in the repository; this phase creates the initial `src/`, `apps/`, and `tests/` areas beside the current Unity package.
- The existing Unity package currently generates databases through `com.jlpm.motionmatching/Editor/Core/MotionMatchingDataEditor.cs`, but Phase 1 does not call or refactor that path.
- The first real local Visual FBX test asset is user-supplied and machine-local. Do not write its absolute path into manifests, docs, tests, commits, logs intended for sharing, or portable workspace state.
- Browser/Codex mode imports files through upload to the backend; direct native file paths are deferred to future Electron/native mode.
- `.motionstudio/` is machine-local dev data and must be git-ignored before any browser workspace or uploaded assets are created.
- FBX import/GLB conversion is the riskiest technical area. Keep it behind importer/cache services so AssimpNet/SharpGLTF choices can be replaced if the real Iyo FBX exposes limitations.

## Out Of Scope For Phase 1

- Animation clip import was originally out of scope for Phase 1, but a narrow post-milestone Clip Import MVP was added after the Visual FBX milestone.
- BVH import was originally out of scope for Phase 1, but `.bvh` files are now accepted as clip sources.
- Bone mapping from animation sources.
- Motion database build/export.
- Unity `.asset` update/overwrite.
- Play Mode.
- Timeline beyond an empty/placeholder bottom area.
- Motion matching runtime/search.
- Manual retargeting or retargeting wizard.
- Electron packaging.

### Post-Milestone Task 9: Clip Import MVP

Add the first clip authoring slice without changing the runtime/search engine. A selected character can import one `.fbx` or `.bvh` file as one clip. The backend copies the source into `Characters/<Character>/Clips/<ClipName>/source.<ext>`, writes `clip.json`, updates `character.json`, and returns the updated character. The frontend shows clips as direct children under their character and selects the imported clip in the inspector.

This task intentionally does not validate skeleton compatibility, preview animation on the visual mesh, edit tags, or compile a database yet.

- [x] Implement (TDD: clip manifest/schema tests and backend upload tests)
- [x] Verify
- [x] Checkpoint — no commit requested

### Post-Milestone Task 10: Clip Timeline Metadata Scaffold

Replace the frontend-only timeline frame count with backend-supplied clip metadata when available. BVH imports parse `Frames` and `Frame Time` from the source file and persist `frameCount`, `frameRate`, and `durationSeconds` into `clip.json`. FBX imports use Assimp to export a temporary GLB and parse glTF animation sampler accessors for duration and keyframe count. Existing clip manifests without timeline fields are lazily backfilled when the browser workspace is opened. The UI keeps an explicit estimated range only when metadata extraction fails.

- [x] Implement (manifest/schema/API fields, BVH metadata extraction, timeline UI consumption)
- [x] Verify
- [x] Checkpoint — no commit requested

### Post-Milestone Task 11: FBX Clip Preview Scrub MVP

Add the first real animation preview path for selected FBX clips. The backend exports each FBX clip source to a derived GLB animation cache under `Clips/<Clip>/Cache/Preview/clip.glb` and exposes the asset URL in `ClipResponse.previewUrl`. The frontend loads that animation GLB in Babylon, retargets animation tracks onto the current visual skeleton by matching node/bone names, and maps timeline frames onto the loaded animation group's frame range for step/scrub preview.

This is intentionally a pragmatic MVP. If future assets expose naming mismatches or retargeting differences, add an importer-backed retarget/cache layer rather than making the frontend solve semantic skeleton mapping.

- [x] Implement (clip preview URL, derived GLB cache, Babylon animation retarget, timeline scrub)
- [x] Verify
- [x] Checkpoint — no commit requested

### Task 1: Repository Tooling And Project Skeleton

Create the initial source layout and make it safe for local browser workspace testing. This includes the .NET solution/projects, the Vite React app, test project skeletons, and `.gitignore` coverage for `.motionstudio/`. Keep the projects minimal: empty app shells are enough here, but they must establish the names and dependencies chosen in the design docs.

Gotchas: do not create any generated workspace assets before `.motionstudio/` is ignored. Do not add Electron, clip import, or build/export scaffolding in this task.

- [x] Implement (TDD: create minimal solution/app/test skeletons, then make the empty build/typecheck/test targets pass)
- [x] Verify
- [x] Checkpoint — no commit requested

### Task 2: JSON Schemas And Authoring Domain Models

Add the first manifest schemas under `docs/schemas/` and matching backend domain models in `MotionMatching.Authoring`. This task covers workspace, character, and visual manifests only. Use camelCase JSON properties, `schemaVersion`, `$schema` where practical, short prefixed IDs, and stable pretty JSON writing.

The workspace model should support a browser workspace with a direct character list, but no clips yet. Visual manifests should store original filename/import metadata but never absolute original paths. Include tests for ID shape, JSON round-tripping, stable serialization, and basic schema validation.

- [x] Implement (TDD: schema/model serialization tests first)
- [x] Verify
- [x] Checkpoint — no commit requested

### Task 3: Backend Workspace And Upload APIs

Implement the ASP.NET Core dev backend shell and the minimum `/api/v1` endpoints needed by the frontend: get/create/open browser workspace and upload Visual FBX for a new character. Use `.motionstudio/browser-workspace/` as the browser workspace root and enforce the 50 MB upload limit.

The Visual FBX upload endpoint should copy the source into the character's `Visual/source.fbx` managed location and create/update manifests, but it does not need to convert or render yet. It should return a task or result payload that the frontend can use to select the new character. Use built-in logging and keep machine-local server logs under `.motionstudio/logs/` if file logging is added.

- [x] Implement (TDD: API/service tests for workspace creation, upload size limit, manifest creation, and no absolute source path in portable manifests)
- [x] Verify
- [x] Checkpoint — no commit requested

### Task 4: Visual FBX Import Validation Service

Add the first `MotionMatching.Importers` service for Visual FBX inspection. It should validate the MVP hard blockers: unreadable/import failure, no skinned mesh, no skeleton, multiple independent skeletons, and missing skin/bind pose data. It should produce findings with the agreed severities and enough summary data for the inspector.

Keep the importer result format independent of AssimpNet or any specific library types. The first implementation can be pragmatic, but the public service contract should expose Studio concepts: canonical skeleton summary, skinned mesh summary, material/texture availability, and validation findings.

- [x] Implement (TDD: importer contract tests with mocked/importer-fixture inputs where possible; real Iyo FBX remains a manual/dev validation asset, not a committed test fixture)
- [x] Verify
- [x] Checkpoint — no commit requested

### Task 5: Preview GLB Cache Generation

Generate a browser-loadable GLB preview asset from the managed Visual FBX and serve it from the backend. Cache output under the character's derived cache area, not in portable manifests. The goal is a GLB that Babylon.js can load and display; material fidelity can be basic, but mesh/skin/skeleton preservation is the priority.

Gotchas: do not introduce Blender. If the chosen library path cannot generate a valid skinned GLB for the real Iyo FBX, keep the service boundary intact and document the importer limitation before trying a replacement library. The backend response should expose a preview asset URL/path plus validation summary.

- [x] Implement (TDD: cache path/service behavior tests; manual real-asset verification for actual FBX-to-GLB rendering)
- [x] Verify
- [x] Checkpoint — no commit requested

### Task 6: Frontend Shell, Workspace Tree, And Inspector

Create the compact dark React shell with resizable splitters: left tree, center viewport, right inspector, and bottom logs/task area. Implement browser workspace startup behavior: open existing browser workspace by default, otherwise allow `New`. The left tree is a direct `Character -> clips` tree; Phase 1 only shows characters.

Add `Add Character` in the left panel. In browser mode it uses file upload, then selects the imported character. The inspector should show character/visual/import/validation details for the selected character. Clip UI can remain absent or placeholder-only.

- [x] Implement (TDD/typecheck-first where practical; keep frontend state local for selection/layout/theme)
- [x] Verify
- [x] Checkpoint — no commit requested

### Task 7: Babylon Viewport Empty Scene And Visual Mesh Rendering

Implement the Babylon viewport with the agreed MVP controls where practical: empty scene for empty workspace, perspective/orthographic camera modes, left-mouse orbit, middle-mouse pan, wheel zoom, WASD camera movement in preview mode, frame selected, and a simple orientation helper. Load the selected character's preview GLB and display it in bind/default pose.

The viewport should remain utilitarian and compact. It does not need Play Mode, animation playback, timeline integration, or skeleton debug overlays in this phase, though the structure should not block adding them.

- [x] Implement (TDD/typecheck plus browser manual verification in Codex)
- [x] Verify
- [x] Checkpoint — no commit requested

### Task 8: Phase 1 Verification And Handoff Update

Run the full Phase 1 verification pass: backend tests, frontend typecheck/lint, and a manual Codex browser test using the local Iyo Visual FBX upload. Confirm that `.motionstudio/` is ignored and that generated assets/logs are not staged. Run the security/portability checklist before reporting the milestone.

Update `05-session-handoff.md` with what was built, how to run it, known importer limitations, and what Phase 2 should address next. Do not commit or push unless the user explicitly asks.

- [x] Implement (update docs/handoff only after verification)
- [x] Verify
- [x] Checkpoint — no commit requested
