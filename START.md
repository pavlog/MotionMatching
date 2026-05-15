# MotionMatching Studio Start Guide

This file is the handoff entry point for a clean machine or a new coding agent.

## Human/Agent Rules

- The user communicates in Russian.
- Reply to the user in Russian.
- Write project artifacts in English: code, docs, comments, UI strings, schemas, commit messages, and plans.
- Do not commit or push unless the user explicitly asks.
- Before sharing, committing, exporting, or zipping, scan for personal data, absolute user paths, private registries, emails, keys, tokens, and local assets.
- Prefer small verified steps over broad rewrites.
- Keep the MotionMatching runtime/core separate from the authoring Studio.

## Project Intent

MotionMatching Studio is a standalone web-first authoring and preview tool for building character motion-matching databases without requiring Unity.

The original Unity package remains in `com.jlpm.motionmatching/`, but the Studio work is moving core, authoring, import, build, preview, and backend concerns into normal .NET projects.

Current MVP direction:

- Visual FBX creates the character and defines canonical mesh, skin, and skeleton.
- Animation FBX/BVH files are imported as clips under a character.
- Preview should happen on the canonical Visual FBX mesh.
- Workspaces are filesystem/JSON based and portable.
- Imported source assets are copied into workspaces.
- Generated previews, build artifacts, logs, and caches are disposable.

## Repository Layout

Important paths:

- `MotionMatchingStudio.sln` - .NET solution.
- `src/MotionMatching.Core/` - portable runtime/core area.
- `src/MotionMatching.Authoring/` - manifests and authoring domain models.
- `src/MotionMatching.Importers/` - FBX/BVH inspection/import services.
- `src/MotionMatching.Builder/` - database build/export area.
- `src/MotionMatching.PreviewRuntime/` - preview cache and runtime helpers.
- `src/MotionMatching.Studio.Backend/` - ASP.NET Core API backend.
- `apps/studio-web/` - Vite React TypeScript frontend.
- `tests/` - xUnit test projects.
- `docs/specs/motion-matching-studio/` - product and implementation handoff docs.
- `docs/schemas/` - JSON schemas for portable manifests.
- `com.jlpm.motionmatching/` - original Unity package.
- `minimalproject/` - Unity minimal project.

Ignored local/generated paths:

- `.tools/`
- `.motionstudio/`
- `node_modules/`
- `dist/`
- `bin/`
- `obj/`
- `TestResults/`

## Current Implemented State

The current browser/dev prototype supports:

- Creating/opening a repo-local browser workspace.
- `Add Character` with Visual FBX upload.
- Visual FBX validation through Assimp CLI.
- Preview GLB generation and serving through the backend.
- Babylon.js viewport with character preview, ground grid, camera mode toggle, and frame selected.
- Left tree showing direct `Character -> clips`.
- `Add Clip` under selected character for `.fbx` and `.bvh`.
- Clip import writes `Clips/<ClipName>/source.<ext>` and `clip.json`, then updates `character.json`.
- Right inspector shows character or clip context.
- Bottom timeline/log panel is present, but timeline playback is not implemented yet.

Known missing pieces:

- Clip skeleton validation against canonical Visual FBX.
- Clip animation playback/scrubbing on the visual mesh.
- Timeline tags and global clip tags.
- Database build/export.
- Unity asset overwrite/update.
- Play Mode.
- Retargeting wizard.
- Electron packaging.

## First Docs To Read

Read these before changing architecture:

1. `docs/specs/motion-matching-studio/05-session-handoff.md`
2. `docs/specs/motion-matching-studio/01-decisions.md`
3. `docs/specs/motion-matching-studio/03-architecture.md`
4. `docs/specs/motion-matching-studio/07-phase-1-implementation-plan.md`
5. `docs/specs/motion-matching-studio/08-windows-migration.md`
6. `docs/specs/motion-matching-studio/06-security-and-portability-checklist.md`

## Prerequisites On A New Machine

Install:

- .NET SDK 8
- Node.js 22 LTS with npm
- Assimp command line tools

macOS example:

```bash
brew install dotnet-sdk node@22 assimp
```

Windows example:

```powershell
winget install Microsoft.DotNet.SDK.8
winget install OpenJS.NodeJS.LTS
```

On Windows, install Assimp separately and either add `assimp.exe` to `PATH` or set:

```powershell
$env:Assimp__ExecutablePath = "C:\Tools\assimp\bin\assimp.exe"
```

## Restore And Verify

From the repository root:

```bash
dotnet restore MotionMatchingStudio.sln
dotnet test MotionMatchingStudio.sln
```

Frontend:

```bash
cd apps/studio-web
npm install
npm run typecheck
npm run lint
npm run build
```

If npm uses a private registry, reset it before installing:

```bash
npm config set registry https://registry.npmjs.org/
npm install
```

## Run The Prototype

Terminal 1, backend:

```bash
dotnet run --project src/MotionMatching.Studio.Backend/MotionMatching.Studio.Backend.csproj --urls http://localhost:5100
```

Terminal 2, frontend:

```bash
cd apps/studio-web
VITE_STUDIO_API_BASE=http://localhost:5100 npm run dev -- --host 127.0.0.1 --port 5173
```

Open:

```text
http://127.0.0.1:5173/
```

Expected behavior:

- Empty workspace shows `Add Character`.
- After Visual FBX import, character appears in the tree and the preview mesh renders.
- After selecting a character, `Add Clip` can import `.fbx` or `.bvh`.
- Imported clips appear as direct children under the character.

## Suggested Next Implementation Step

Implement clip validation and preview in this order:

1. Add importer-side clip inspection result that can read skeleton hierarchy from FBX/BVH.
2. Compare clip skeleton bone names against the canonical Visual FBX skeleton.
3. Compare bone lengths with tolerance and report warnings/errors through validator classes.
4. Return per-clip validation in backend `ClipResponse`.
5. Show clip validation badges in the left tree and findings in the inspector.
6. Add selected clip playback/scrubbing on the canonical visual mesh.

Keep validators as separate extensible classes. Each validator should report what it dislikes instead of hardcoding all guesses into one import function.

## Security And Portability Checklist

Before sharing or committing:

```bash
git status --short
rg -n '(/Users/|C:\\Users\\|BEGIN (RSA|OPENSSH|PRIVATE) KEY|AKIA[0-9A-Z]{16}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|api[_-]?key|token|password|secret|client[_-]?secret)' .
```

Expected false positives may include the checklist pattern itself. Review all matches manually.

Never include:

- `.motionstudio/`
- uploaded local FBX/BVH files
- preview GLB caches
- local screenshots
- `.tools/`
- `node_modules/`
- `bin/obj`
- private registry URLs
- machine-local absolute paths
