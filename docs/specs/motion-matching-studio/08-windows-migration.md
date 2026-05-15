# Windows Migration And Continuation Guide

Created: 2026-05-14

This guide explains how to move MotionMatching Studio development from macOS to Windows and continue from a clean checkout or portable zip.

## What To Transfer

Transfer the repository source files only.

Include:

- `MotionMatchingStudio.sln`
- `src/`
- `tests/`
- `apps/studio-web/`
- `docs/`
- `com.jlpm.motionmatching/`
- `minimalproject/`
- root config files such as `.gitignore`, `.nvmrc`, and `global.json`

Do not transfer:

- `.tools/`
- `.motionstudio/`
- `node_modules/`
- `dist/`
- `bin/`
- `obj/`
- `TestResults/`
- `.DS_Store`

`.motionstudio/` is local development data. It may contain uploaded assets, preview caches, local screenshots, and machine-specific scratch files. If a workspace must be moved later, export or zip a proper portable Studio workspace instead of copying `.motionstudio/` blindly.

## Windows Prerequisites

Install:

- Git for Windows
- .NET SDK 8
- Node.js 22 LTS with npm
- Assimp command line tools

Recommended install routes:

```powershell
winget install Git.Git
winget install Microsoft.DotNet.SDK.8
winget install OpenJS.NodeJS.LTS
```

Assimp availability varies by Windows package manager. Good options are:

- Install from an official Assimp release and add the folder containing `assimp.exe` to `PATH`.
- Install with Chocolatey if available:

```powershell
choco install assimp
```

- Install with vcpkg or another C++ package workflow, then point Studio to the produced `assimp.exe`.
- If package managers do not provide `assimp.exe`, build the command-line tool from the official source repository into ignored local tooling. See "Build Assimp CLI From Source" below.

## Fresh Checkout Setup

From PowerShell:

```powershell
git clone https://github.com/pavlog/MotionMatching.git MotionMatchingStudio
cd MotionMatchingStudio
git checkout motionmatching-studio-phase-1
```

If using a zip instead of git, unzip it into a short path without spaces, for example:

```text
C:\Dev\MotionMatchingStudio
```

Avoid putting the repo under OneDrive-synced folders while developing. File watcher and generated cache behavior is more predictable in a normal local folder.

## Restore And Verify .NET

If global .NET 8 is installed:

```powershell
dotnet --version
dotnet restore MotionMatchingStudio.sln
dotnet test MotionMatchingStudio.sln
```

If the repo's `global.json` asks for a newer feature version than installed, either install that SDK or update `global.json` to the available .NET 8 SDK after confirming with the project owner.

## Restore And Verify Frontend

```powershell
cd apps\studio-web
npm install
npm run typecheck
npm run lint
npm run build
cd ..\..
```

If npm tries to use a private/corporate registry, reset it before generating `package-lock.json`:

```powershell
npm config set registry https://registry.npmjs.org/
npm install
```

Before committing any regenerated lock file, run the security/portability checklist and verify there are no private registry URLs.

## Configure Assimp On Windows

The backend looks for `assimp` on `PATH` by default. On Windows, either add `assimp.exe` to `PATH` or configure the executable path explicitly.

PowerShell example:

```powershell
$env:Assimp__ExecutablePath = "C:\Tools\assimp\bin\assimp.exe"
```

The double underscore maps to the .NET configuration key `Assimp:ExecutablePath`.

To persist the path for new terminals:

```powershell
[Environment]::SetEnvironmentVariable(
  "Assimp__ExecutablePath",
  "C:\Path\To\assimp.exe",
  "User")
```

Restart terminals after changing user-level environment variables.

Verify:

```powershell
assimp version
assimp info C:\Path\To\VisualCharacter.fbx
```

Expected for a usable Visual FBX:

- At least one mesh with bones.
- Exactly one canonical skeleton.
- Non-zero bone count.

## Build Assimp CLI From Source

Use this fallback when `winget`, Chocolatey, or downloaded prebuilt archives do not provide the command-line `assimp.exe`. Keep all source and build output under `.tools/`, which is ignored and must not be committed.

Prerequisites:

- Git for Windows
- Visual Studio Build Tools or Visual Studio Community with MSBuild and C++ toolchain
- CMake, either on `PATH` or from the Visual Studio CMake bundle

Example using the Visual Studio bundled CMake:

```powershell
$cmake = "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"

git clone --depth 1 --branch v6.0.5 https://github.com/assimp/assimp.git .tools\assimp-src

& $cmake `
  -S .tools\assimp-src `
  -B .tools\assimp-build `
  -G "Visual Studio 18 2026" `
  -A x64 `
  -DASSIMP_BUILD_ASSIMP_TOOLS=ON `
  -DASSIMP_BUILD_TESTS=OFF `
  -DASSIMP_BUILD_SAMPLES=OFF `
  -DASSIMP_INSTALL=OFF `
  -DBUILD_SHARED_LIBS=ON

& $cmake --build .tools\assimp-build --config Release --target assimp_cmd --parallel

& .tools\assimp-build\bin\Release\assimp.exe version
```

The generated executable is:

```text
.tools\assimp-build\bin\Release\assimp.exe
```

Set Studio to use it:

```powershell
[Environment]::SetEnvironmentVariable(
  "Assimp__ExecutablePath",
  (Resolve-Path ".tools\assimp-build\bin\Release\assimp.exe").Path,
  "User")
```

For the current terminal only:

```powershell
$env:Assimp__ExecutablePath = (Resolve-Path ".tools\assimp-build\bin\Release\assimp.exe").Path
```

Notes from the first Windows setup:

- `winget search assimp` may return no package.
- `choco search assimp` may return no package even when Chocolatey is installed.
- SourceForge Windows archives for recent Assimp releases may contain SDK binaries such as DLL/PDB files without `assimp.exe`.
- The CMake target named `assimp` builds the library. The command-line executable target is `assimp_cmd`, and its output name is `assimp.exe`.

## Run The Studio

Terminal 1, backend:

```powershell
$env:Assimp__ExecutablePath = "C:\Tools\assimp\bin\assimp.exe"
dotnet run --project src\MotionMatching.Studio.Backend\MotionMatching.Studio.Backend.csproj --urls http://localhost:5100
```

If Codex Desktop or another sandbox cannot read `C:\Users\<you>\AppData\Roaming\NuGet\NuGet.Config`, use an already-built backend DLL or `--no-restore`:

```powershell
dotnet run --no-restore --project src\MotionMatching.Studio.Backend\MotionMatching.Studio.Backend.csproj --urls http://localhost:5100
```

Terminal 2, frontend:

```powershell
cd apps\studio-web
npm run dev -- --host 127.0.0.1 --port 5173
```

The Vite dev server proxies `/api` to `http://localhost:5100`. This avoids cross-port localhost requests from the Codex in-app browser, which may otherwise report `ERR_BLOCKED_BY_CLIENT`.

Open:

```text
http://127.0.0.1:5173/
```

Expected first run:

- Empty workspace tree.
- `Add Character` button.
- Empty Babylon viewport.
- Inspector waiting for selection.

After importing a Visual FBX:

- Character appears in the left tree.
- Inspector shows validation status.
- Preview reports `Ready`.
- Babylon viewport renders the character mesh in bind/default pose.

## Browser Workspace Location

In dev mode, browser workspace data is stored under:

```text
.motionstudio/browser-workspace/
```

This folder is intentionally ignored by git. It is safe to delete when you want a fresh local test workspace.

Do not commit:

- Uploaded FBX files.
- Generated GLB previews.
- Screenshots.
- Local logs.
- Scratch scripts.

## Common Windows Issues

### Backend cannot find Assimp

Symptom:

```text
Assimp failed
```

Fix:

- Confirm `assimp.exe` exists.
- Add it to `PATH`, or set `Assimp__ExecutablePath`.
- Restart the backend terminal after changing environment variables.

### Frontend cannot reach backend

Symptom:

```text
Open workspace failed
```

Fix:

- Confirm backend is running on `http://localhost:5100`.
- Confirm frontend is running through Vite on `http://127.0.0.1:5173` so `/api` requests use the dev proxy.
- Check Windows Defender Firewall if the browser cannot connect to localhost.

### GLB preview is generated but mesh does not render

Fix:

- Open browser dev tools and check console errors.
- Confirm `/api/v1/workspaces/browser/assets/.../visual.glb` returns `200`.
- Re-import the Visual FBX after deleting `.motionstudio/browser-workspace/`.
- Run `assimp info` on the source FBX and confirm it reports meshes and bones.

### PowerShell execution policy blocks scripts

If npm or local scripts are blocked:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Security And Portability Before Sharing

Before sharing, committing, or zipping:

```powershell
git status --short
```

Review every untracked file. Also run the sensitive-data search from:

```text
docs/specs/motion-matching-studio/06-security-and-portability-checklist.md
```

Never commit or push without explicit project-owner approval.
