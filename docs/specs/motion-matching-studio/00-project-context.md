# MotionMatching Studio Project Context

Created: 2026-05-14

## Purpose

MotionMatching Studio is a standalone authoring and preview tool for character motion-matching databases.

The tool must let a user:

- Create a character database.
- Import a canonical visual FBX for the character.
- Import animation clips from FBX or BVH files.
- Automatically map and validate imported animation skeletons against the canonical visual skeleton.
- Automatically suggest clip roles, tags, and foot contacts where possible.
- Build a database compatible with the current Unity MotionMatching runtime format.
- Preview the character on a flat plane inside the tool without launching Unity.

The first MVP is a vertical slice for fast authoring feedback:

1. Open the Studio in browser/dev mode.
2. Create or open a workspace.
3. Add one character with a Visual FBX.
4. Add at least one FBX or BVH animation clip.
5. See the animation applied to the Visual FBX mesh.
6. Build the database.
7. Enter Play Mode on a flat plane and run/jump with the selected character.

## Product Philosophy

Authoring should be rich, forgiving, and fast. Runtime should be small, simple, portable, and explicit.

MotionMatching Studio is allowed to be a large tool with importers, validation, preview rendering, tagging workflows, logs, and build reports. Runtime consumers should receive a compact database artifact and use a small runtime contract:

- Load database.
- Build query feature vector.
- Search best pose.
- Sample pose.
- Blend or inertialize where applicable.
- Advance state.

The long-term goal is that only the runtime engine and data layout need deep optimization or porting. Authoring can remain comfortable in C#/.NET and web tooling.

## Existing Repository Context

The current repository contains the original Unity-oriented MotionMatching package:

- Unity package: `com.jlpm.motionmatching`
- Minimal Unity project: `minimalproject`
- Existing database generation button: `com.jlpm.motionmatching/Editor/Core/MotionMatchingDataEditor.cs`

The current Unity editor database generation path does:

1. `MotionMatchingData.ImportPoseSet()`
2. Serialize `.mmpose` and `.mmskeleton`
3. `MotionMatchingData.ComputeJointsLocalForward()`
4. `MotionMatchingData.ImportFeatureSet()`
5. Serialize `.mmfeatures`
6. `AssetDatabase.Refresh()`

The existing builder logic is partly reusable, but it is strongly coupled to Unity types and systems such as `UnityEngine`, `ScriptableObject`, `TextAsset`, `HumanBodyBones`, `Application.streamingAssetsPath`, `NativeArray`, editor inspectors, and `AssetDatabase`.

## Relationship To The Original Engine

MotionMatching Studio is a separate product area inside this repository, not just a patch to the Unity inspector.

The intended future structure is:

- `MotionMatching.Core`: common engine/data model and runtime/database logic.
- `MotionMatching.Authoring`: authoring model, validation, manifests, project workflow.
- `MotionMatching.Importers`: BVH/FBX importers and conversion into canonical animation data.
- `MotionMatching.Builder`: database build pipeline and export targets.
- `MotionMatching.PreviewRuntime`: flat-plane input/controller/motion-matching preview.
- `MotionMatching.Studio`: web-first tool frontend/backend product.
- `MotionMatching.UnityAdapter`: optional Unity-side adapter/runtime integration.

The rule is: motion-matching algorithm and database-contract improvements should live in shared core layers first. Unity and Studio should adapt to the shared core, not fork behavior independently.

## Communication And Writing Rules

Conversation with the user is in Russian.

All project artifacts are in English:

- Code
- Comments
- Documentation
- JSON schemas
- UI strings
- Commit messages
- Test names
- Logs and generated reports where practical

## Portability And Safety Rules

Workspace projects must be self-contained and portable as a zip. Portable project state must not depend on absolute local paths.

Before committing, exporting, zipping, or sharing anything, always check for sensitive data:

- API keys
- Tokens
- Passwords
- Private certificates or keys
- Emails
- Personal names where not intended
- Absolute local paths
- Machine-specific settings
- Private repository URLs
- License-sensitive assets

Machine-local settings, such as optional external export paths, must be kept outside portable project manifests.

See `06-security-and-portability-checklist.md` for the concrete checklist and suggested search commands.

Never commit or push unless the user explicitly asks for that action.
