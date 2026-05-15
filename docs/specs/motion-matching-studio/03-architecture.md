# MotionMatching Studio Architecture

Created: 2026-05-14

## High-Level Architecture

```text
Vite React Frontend
  - desktop-style UI
  - Babylon.js viewport
  - timeline, inspector, logs
  - no direct FBX/BVH parsing
        |
        | REST + WebSocket
        v
ASP.NET Core Backend
  - workspace/project services
  - FBX/BVH import
  - preview GLB/cache generation
  - validation
  - build pipeline
  - preview simulation stream
        |
        v
MotionMatching Libraries
  - Core
  - Authoring
  - Importers
  - Builder
  - PreviewRuntime
        |
        v
Portable Workspace + Derived Outputs
```

## Project Areas

### MotionMatching.Core

Shared engine/data model and small runtime reference implementation.

Responsibilities:

- Canonical skeleton representation.
- Pose representation.
- Animation clip pose streams.
- Feature layout and feature vectors.
- Database read/write contracts.
- Runtime search/query contracts.
- Portable runtime logic where possible.

Should avoid:

- Unity-specific types.
- UI concepts.
- File picker/workspace concerns.
- Rendering concerns.
- FBX/BVH parser details.

### MotionMatching.Authoring

Authoring domain model and project workflow.

Responsibilities:

- Workspace model.
- Character model.
- Clip model.
- Tag vocabulary.
- Clip roles.
- Dirty state.
- Autosave.
- Validation orchestration.
- Build reports.
- Operation logs.

### MotionMatching.Importers

Import source assets into common authoring/core data.

Responsibilities:

- Visual FBX import.
- Animation FBX import.
- BVH import.
- Guess source-to-canonical bone mappings.
- Load/compose extensible bone mapping guess rules.
- Extract source animation pose streams.
- Convert Visual FBX to preview GLB/cache.
- Preserve metadata such as original filename and import timestamp.

Importers should output common data structures instead of leaking source format details into builders/runtime.

### MotionMatching.Builder

Turn authoring state into runtime database artifacts.

Responsibilities:

- Built-in locomotion feature preset.
- Pose extraction.
- Feature extraction.
- Normalization.
- Current Unity-compatible export:
  - `.mmskeleton`
  - `.mmpose`
  - `.mmfeatures`
- Build report generation.
- External export copy.

### MotionMatching.PreviewRuntime

In-tool runtime prototype.

Responsibilities:

- Flat-plane character controller.
- WASD input interpretation.
- Ground locomotion.
- Jump/air/land states.
- Motion-matching query construction.
- Runtime role usage.
- Debug data for viewport overlays.

PreviewRuntime is allowed to become the reference controller design for the game if its behavior proves better than the existing controller.

### MotionMatching.Studio

Product shell.

Responsibilities:

- ASP.NET Core backend app.
- Vite React frontend app.
- API contracts.
- Background task queue and task status streaming.
- Local dev startup.
- Future Electron packaging.

### MotionMatching.UnityAdapter

Future optional Unity integration.

Responsibilities:

- Read exported database.
- Bridge to Unity runtime types.
- Keep compatibility with existing package where possible.
- Later: generate/import Unity descriptors.

## Data Flow

### Visual Import

```text
Visual FBX
  -> backend import service
  -> canonical skeleton
  -> skinned mesh/material preview data
  -> preview GLB/cache
  -> visual manifest
  -> validators
```

### Animation Import

```text
Animation FBX/BVH
  -> backend import service
  -> source skeleton + source pose stream
  -> guessed mapping to canonical skeleton
  -> canonical pose stream
  -> auto role/tag/contact suggestions
  -> clip manifest
  -> validators
```

### Preview Clip

```text
Selected clip
  -> canonical pose stream from backend/cache
  -> WebSocket or REST pose frames
  -> Babylon.js applies transforms to GLB visual skeleton
  -> timeline and overlays update
```

### Build

```text
Character manifests + source assets
  -> import/cache validation
  -> canonical pose streams
  -> built-in locomotion feature preset
  -> PoseSet / FeatureSet
  -> Unity-compatible serializers
  -> Derived/Builds/Current
  -> optional external export target
  -> build-report.json + operation log
```

### Play Mode

```text
Last successful build
  -> PreviewRuntime loads database
  -> frontend sends WASD input
  -> backend simulates controller + motion matching
  -> backend streams pose/debug frames
  -> Babylon.js renders character on flat plane
```

## API Shape

REST for commands and state:

```text
POST /api/v1/workspaces/create
POST /api/v1/workspaces/open
GET  /api/v1/workspace

POST /api/v1/characters
GET  /api/v1/characters/{characterId}
PATCH /api/v1/characters/{characterId}

POST /api/v1/characters/{characterId}/visual/import
POST /api/v1/characters/{characterId}/visual/replace

POST /api/v1/characters/{characterId}/clips/import
POST /api/v1/characters/{characterId}/clips/{clipId}/replace-source
PATCH /api/v1/characters/{characterId}/clips/{clipId}

POST /api/v1/characters/{characterId}/build
GET  /api/v1/characters/{characterId}/build/latest-report

POST /api/v1/preview/start
POST /api/v1/preview/stop
POST /api/v1/preview/input
```

WebSocket streams:

```text
/ws/v1/tasks
/ws/v1/preview
/ws/v1/logs
```

Exact routes are not final; this is the MVP direction.

## Manifest Types

Expected schemas:

- `motionworkspace.schema.json`
- `motioncharacter.schema.json`
- `motionvisual.schema.json`
- `motionclip.schema.json`

All manifests:

- Use JSON.
- Include `schemaVersion`.
- Should include `$schema` when practical.
- Use stable property ordering.
- Avoid absolute paths in portable state.

## Preview Rendering Contract

Frontend owns rendering. Backend owns truth and simulation.

Frontend receives:

- GLB preview model URL/path.
- Skeleton/bone metadata.
- Pose transforms per frame.
- Debug overlays.
- Timeline/contact/tag data.

Backend owns:

- FBX/BVH import.
- Canonical skeleton.
- Pose streams.
- Motion matching.
- Play Mode state.
- Validation and build.

## Build Compatibility Contract

MVP must write files compatible with the current Unity package folder convention:

```text
<MMDatabasesRoot>/<CharacterName>/
  <CharacterName>.mmskeleton
  <CharacterName>.mmpose
  <CharacterName>.mmfeatures
```

The current Unity descriptor asset can be configured manually for first tests. Studio does not need to generate Unity descriptors in MVP.

## Future Optimization Direction

Authoring data can remain rich and editable. Export lowers it into target-specific runtime data.

Future database format should support chunking/versioning:

```text
Header
  magic
  formatVersion
  endian
  chunks[]

Chunks
  Skeleton
  Clips
  Poses
  Tags
  FeatureLayout
  FeatureVectors
  Normalization
  SearchIndex
  Metadata
```

Later runtime/database optimizations can include:

- SIMD search.
- Burst search in Unity.
- C++/Rust runtime ports.
- GPU/compute search.
- Cache-friendly SoA data layout.
- BVH/k-d tree/product quantization search indices.
- Pose compression.
- Feature quantization.
