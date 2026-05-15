# MotionMatching Studio Session Handoff

Created: 2026-05-14

## Current State

The repository was cloned from `https://github.com/pavlog/MotionMatching`.

The current branch is `motionmatching-studio-phase-1`.

The user wants to build MotionMatching Studio: a standalone web-first authoring and preview tool for character motion-matching databases.

The user communicates in Russian, but all project artifacts must be written in English.

Phase 1 implementation is now in progress and the first runnable browser milestone has been built.

After the first Visual FBX milestone, a narrow Clip Import MVP slice was added so the left tree can already show `Character -> clips`.

## Most Important Decisions

- Product name: `MotionMatching Studio`.
- MVP must run without Unity.
- MVP should run in Codex/browser dev mode through local Vite + ASP.NET Core servers.
- Frontend: Vite + React + TypeScript.
- Viewport: Babylon.js.
- Backend: ASP.NET Core REST + WebSocket.
- No Electron for MVP; Electron packaging later.
- No Blender dependency for MVP.
- Backend imports FBX/BVH and generates GLB preview cache.
- Visual FBX is canonical and defines character mesh/skin/skeleton.
- Visual FBX is required before importing animation clips for a usable character in MVP.
- Animation FBX/BVH files are motion sources only.
- All animation preview happens on the canonical Visual FBX mesh.
- Workspace is filesystem/JSON based and portable as a zip.
- Source assets are copied into workspace.
- Derived caches/builds/logs are disposable.
- MVP exports current Unity-compatible `.mmskeleton/.mmpose/.mmfeatures`.
- Unity descriptor generation is not MVP.
- Build inclusion is an explicit clip flag, not a tag.
- Clip roles are separate from tags.
- Play Mode is a real mechanics prototype with ground locomotion and jump.
- Missing required roles do not block Play Mode; warnings are shown.

## User Preferences

- The user strongly prefers fast authoring with automatic guesses wherever possible.
- Manual work should be correction, not data entry.
- The user wants a desktop-tool layout:
  - left characters/clips
  - center 3D viewport
  - right universal inspector
  - bottom timeline and logs
- The user wants to inspect animation artifacts on a skinned mesh, not only skeleton bones.
- The user wants project docs good enough that a clean future agent can continue after a reboot or context compaction.
- Always check for sensitive data before sharing/committing/exporting/zipping.

## How To Run The Current Prototype

Prerequisites used in this session:

- .NET SDK 8 installed locally under `.tools/dotnet`.
- Node 22 installed with Homebrew.
- `assimp` installed with Homebrew for FBX inspection and GLB preview export.

Backend:

```bash
./.tools/dotnet/dotnet run --project src/MotionMatching.Studio.Backend/MotionMatching.Studio.Backend.csproj --urls http://localhost:5100
```

Frontend:

```bash
cd apps/studio-web
PATH=/opt/homebrew/opt/node@22/bin:$PATH VITE_STUDIO_API_BASE=http://localhost:5100 npm run dev -- --host 127.0.0.1 --port 5173
```

Open:

```text
http://127.0.0.1:5173/
```

Windows migration notes are maintained in:

```text
docs/specs/motion-matching-studio/08-windows-migration.md
```

## Built In Phase 1 So Far

- Created `MotionMatchingStudio.sln` with Core, Authoring, Importers, Builder, PreviewRuntime, Backend, and test projects.
- Created Vite React TypeScript frontend under `apps/studio-web`.
- Added JSON schemas under `docs/schemas/`.
- Added Authoring manifest models for workspace, character, and visual manifests.
- Added Authoring manifest model and JSON schema for animation clip manifests.
- Added browser workspace backend APIs under `/api/v1`.
- Added Visual FBX upload for `Add Character`.
- Added FBX/BVH clip upload for `Add Clip` under the selected character.
- Added Assimp CLI based Visual FBX inspection.
- Added GLB preview cache generation.
- Added GLB post-processing that strips external texture references so preview loading is not broken by missing FBX texture paths.
- Added compact editor shell with left tree, Babylon viewport, right inspector, and bottom timeline/log area.
- Added Babylon GLB rendering in bind/default pose with perspective/orthographic toggle and frame selected.
- Added 3D viewport ground grid and fixed orthographic sizing to use the actual viewport aspect ratio.
- Added direct character/clip tree rendering and context-sensitive clip inspector.
- Verified the local Iyo Visual FBX manually in browser/dev flow.

## Verification Commands

Run backend and .NET tests:

```bash
./.tools/dotnet/dotnet test MotionMatchingStudio.sln
```

Run frontend checks:

```bash
cd apps/studio-web
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run lint
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build
```

Manual/browser verification used a local user-supplied Iyo Mixamo FBX. Do not write its absolute path into portable manifests or docs.

## Suggested Next Step

Timeline keyboard shortcuts were confirmed:

```text
Space = play/pause
Left/Right = step one frame when paused
Shift+Left/Right = jump 10 frames
Home/End = first/last frame
```

The next useful implementation thread is clip validation and preview:

- compare clip skeleton bone names and bone lengths against the canonical Visual FBX skeleton
- add per-clip validation findings to the tree and inspector
- begin timeline playback/scrubbing for the selected clip on the canonical visual mesh
- then add basic global clip tags and include/exclude build control in the inspector

Recent additional decisions:

- Visual FBX import is required to create a usable character.
- `Add Character` opens a Visual FBX file picker.
- Empty workspace shows `Add Character` in the left panel and an empty viewport scene.
- Left panel is a direct `Character -> clips` tree.
- UI is compact, dark, utilitarian, and editor-like.
- Context menus are expected on character rows, clip rows, viewport, and timeline.
- Delete Character/Delete Clip physically remove folders after confirmation; no trash in MVP.
- UI build is per character; CLI build and Build All are later.
- First implementation order should start with schemas/domain models, app skeleton, empty workspace, left tree, and empty viewport.
- First coding milestone is Visual FBX import/render only: Codex browser, browser workspace, upload local Iyo Visual FBX, generate preview GLB/cache, show Iyo in viewport, show character validation in inspector. Animation clips come later.
- Clip Import MVP was added after that milestone: `Add Clip` accepts `.fbx` and `.bvh`, writes `Clips/<ClipName>/source.<ext>` plus `clip.json`, updates `character.json`, selects the imported clip, and shows it in the inspector.
- Phase 1 implementation plan has been written at `07-phase-1-implementation-plan.md`.
- Do not commit or push unless the user explicitly asks.
- Continue answering the user in Russian, but keep code, docs, comments, and UI strings in English.

## Files Created In This Session

- `docs/specs/motion-matching-studio/00-project-context.md`
- `docs/specs/motion-matching-studio/01-decisions.md`
- `docs/specs/motion-matching-studio/02-mvp-scope.md`
- `docs/specs/motion-matching-studio/03-architecture.md`
- `docs/specs/motion-matching-studio/04-open-questions.md`
- `docs/specs/motion-matching-studio/05-session-handoff.md`
- `docs/specs/motion-matching-studio/06-security-and-portability-checklist.md`
- `docs/specs/motion-matching-studio/07-phase-1-implementation-plan.md`
- `docs/specs/motion-matching-studio/08-windows-migration.md`

## Known Limitations

- Browser file upload was verified through backend upload automation; the visible file picker still needs a manual user click in the browser UI.
- Preview GLB materials are intentionally simplified; external texture references are stripped for reliable loading.
- Babylon bundle size is large in the first implementation.
- `assimp` is currently expected to be available on the machine. Future packaging should bundle or discover it cleanly.
- Clip import exists, but clip skeleton validation, animation preview, timeline tags, database build/export, Unity asset overwrite, Play Mode, and retargeting are not implemented yet.
