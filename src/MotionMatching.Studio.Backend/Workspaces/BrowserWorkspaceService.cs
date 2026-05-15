using System.Globalization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using MotionMatching.Authoring;
using MotionMatching.Importers;
using MotionMatching.PreviewRuntime;

namespace MotionMatching.Studio.Backend.Workspaces;

public sealed class BrowserWorkspaceService
{
    private const string WorkspaceFileName = "workspace.json";
    private readonly StudioBackendOptions _options;
    private readonly IVisualFbxInspector _visualInspector;
    private readonly IClipTimelineExtractor _clipTimelineExtractor;
    private readonly ISkeletonNameExtractor _skeletonNameExtractor;
    private readonly PreviewGlbCacheService _previewCache;

    public BrowserWorkspaceService(
        IOptions<StudioBackendOptions> options,
        IVisualFbxInspector visualInspector,
        IClipTimelineExtractor clipTimelineExtractor,
        ISkeletonNameExtractor skeletonNameExtractor,
        PreviewGlbCacheService previewCache)
    {
        _options = options.Value;
        _visualInspector = visualInspector;
        _clipTimelineExtractor = clipTimelineExtractor;
        _skeletonNameExtractor = skeletonNameExtractor;
        _previewCache = previewCache;
    }

    public async Task<WorkspaceResponse?> TryOpenBrowserWorkspaceAsync(CancellationToken cancellationToken)
    {
        var workspacePath = GetWorkspaceManifestPath();
        if (!File.Exists(workspacePath))
        {
            return null;
        }

        var workspace = ManifestJson.Deserialize<WorkspaceManifest>(await File.ReadAllTextAsync(workspacePath, cancellationToken));
        return await ToResponseAsync(workspace, cancellationToken);
    }

    public async Task<WorkspaceResponse> CreateOrOpenBrowserWorkspaceAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(GetWorkspaceRoot());
        var workspacePath = GetWorkspaceManifestPath();
        if (File.Exists(workspacePath))
        {
            var existing = ManifestJson.Deserialize<WorkspaceManifest>(await File.ReadAllTextAsync(workspacePath, cancellationToken));
            return await ToResponseAsync(existing, cancellationToken);
        }

        var workspace = new WorkspaceManifest
        {
            Id = StudioId.New("wrk"),
            Name = "Browser Workspace",
            Mode = WorkspaceMode.Browser
        };

        await WriteManifestAsync(workspacePath, workspace, cancellationToken);
        return await ToResponseAsync(workspace, cancellationToken);
    }

    public async Task<CharacterResponse> ImportVisualCharacterAsync(IFormFile visualFile, CancellationToken cancellationToken)
    {
        var workspace = await EnsureWorkspaceManifestAsync(cancellationToken);
        var characterName = Path.GetFileNameWithoutExtension(visualFile.FileName);
        if (string.IsNullOrWhiteSpace(characterName))
        {
            throw new InvalidOperationException("Visual file name cannot be empty.");
        }

        var characterFolderName = ReserveCharacterFolderName(characterName);
        var characterRoot = Path.Combine(GetWorkspaceRoot(), "Characters", characterFolderName);
        var visualRoot = Path.Combine(characterRoot, "Visual");
        Directory.CreateDirectory(visualRoot);

        var sourcePath = Path.Combine(visualRoot, "source.fbx");
        await using (var stream = File.Create(sourcePath))
        await using (var input = visualFile.OpenReadStream())
        {
            await input.CopyToAsync(stream, cancellationToken);
        }

        var visual = VisualManifest.FromUploadedSource(StudioId.New("vis"), visualFile.FileName, visualFile.Length) with
        {
            ImportedAtUtc = DateTimeOffset.UtcNow
        };

        var character = new CharacterManifest
        {
            Id = StudioId.New("chr"),
            Name = characterName,
            VisualManifestPath = "Visual/visual.json"
        };

        await WriteManifestAsync(Path.Combine(visualRoot, "visual.json"), visual, cancellationToken);
        await WriteManifestAsync(Path.Combine(characterRoot, "character.json"), character, cancellationToken);

        var validation = await _visualInspector.InspectAsync(sourcePath, cancellationToken);
        string? previewUrl = null;
        var importLog = new List<ImportLogEntryResponse>
        {
            Info($"Stored visual source {visualFile.FileName}"),
            validation.CanCompile
                ? Info("Visual FBX validation passed")
                : Error("Visual FBX validation blocked preview generation")
        };
        if (validation.CanCompile)
        {
            var previewPath = PreviewGlbCacheService.GetDefaultPreviewPath(characterRoot);
            var preview = await _previewCache.GenerateAsync(sourcePath, previewPath, cancellationToken);
            if (preview.Succeeded)
            {
                previewUrl = ToAssetUrl("Characters", characterFolderName, "Cache", "Preview", "visual.glb");
                importLog.Add(Info("Generated character preview GLB"));
            }
            else
            {
                importLog.Add(Warning("Character preview GLB was not generated"));
            }
        }

        workspace.Characters.Add(new CharacterReference
        {
            Id = character.Id,
            Name = character.Name,
            ManifestPath = ToPortablePath("Characters", characterFolderName, "character.json")
        });

        await WriteManifestAsync(GetWorkspaceManifestPath(), workspace, cancellationToken);

        return new CharacterResponse(
            character.Id.Value,
            character.Name,
            ToPortablePath("Characters", characterFolderName, "character.json"),
            character.VisualManifestPath,
            [],
            previewUrl,
            ToValidationResponse(validation),
            importLog);
    }

    public async Task<CharacterResponse> ImportClipAsync(
        string characterId,
        IFormFile clipFile,
        CancellationToken cancellationToken)
    {
        var workspace = await EnsureWorkspaceManifestAsync(cancellationToken);
        var reference = workspace.Characters.FirstOrDefault(character => character.Id.Value == characterId)
            ?? throw new InvalidOperationException("Character was not found.");

        var characterManifestPath = Path.Combine(GetWorkspaceRoot(), reference.ManifestPath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(characterManifestPath))
        {
            throw new InvalidOperationException("Character manifest was not found.");
        }

        var character = ManifestJson.Deserialize<CharacterManifest>(await File.ReadAllTextAsync(characterManifestPath, cancellationToken));
        var characterRoot = Path.GetDirectoryName(characterManifestPath) ?? throw new InvalidOperationException("Character manifest path has no directory.");
        var requestedClipName = Path.GetFileNameWithoutExtension(clipFile.FileName);
        if (string.IsNullOrWhiteSpace(requestedClipName))
        {
            throw new InvalidOperationException("Clip file name cannot be empty.");
        }

        var clipFolderName = ReserveClipFolderName(characterRoot, requestedClipName);
        var clipRoot = Path.Combine(characterRoot, "Clips", clipFolderName);
        Directory.CreateDirectory(clipRoot);

        var extension = Path.GetExtension(clipFile.FileName).ToLowerInvariant();
        var sourcePath = Path.Combine(clipRoot, $"source{extension}");
        var clip = ClipManifest.FromUploadedSource(
            StudioId.New("clp"),
            clipFolderName,
            clipFile.FileName,
            clipFile.Length) with
        {
            ImportedAtUtc = DateTimeOffset.UtcNow
        };

        await using (var stream = File.Create(sourcePath))
        await using (var input = clipFile.OpenReadStream())
        {
            await input.CopyToAsync(stream, cancellationToken);
        }

        clip = await PopulateClipTimelineMetadataAsync(clip, sourcePath, cancellationToken);

        var clipManifestPath = ToPortablePath("Clips", clipFolderName, "clip.json");
        await WriteManifestAsync(Path.Combine(clipRoot, "clip.json"), clip, cancellationToken);

        if (!character.ClipManifestPaths.Contains(clipManifestPath, StringComparer.Ordinal))
        {
            character.ClipManifestPaths.Add(clipManifestPath);
            await WriteManifestAsync(characterManifestPath, character, cancellationToken);
        }

        return await ToCharacterResponseAsync(reference, cancellationToken);
    }

    public async Task<CharacterResponse> DeleteClipAsync(
        string characterId,
        string clipId,
        CancellationToken cancellationToken)
    {
        var workspace = await EnsureWorkspaceManifestAsync(cancellationToken);
        var reference = workspace.Characters.FirstOrDefault(character => character.Id.Value == characterId)
            ?? throw new KeyNotFoundException("Character was not found.");

        var characterManifestPath = Path.Combine(GetWorkspaceRoot(), reference.ManifestPath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(characterManifestPath))
        {
            throw new KeyNotFoundException("Character manifest was not found.");
        }

        var character = ManifestJson.Deserialize<CharacterManifest>(await File.ReadAllTextAsync(characterManifestPath, cancellationToken));
        var characterRoot = Path.GetDirectoryName(characterManifestPath) ?? throw new InvalidOperationException("Character manifest path has no directory.");
        string? deletedManifestPath = null;
        string? deletedClipRoot = null;

        foreach (var relativeManifestPath in character.ClipManifestPaths)
        {
            var clipManifestPath = Path.Combine(characterRoot, relativeManifestPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(clipManifestPath))
            {
                continue;
            }

            var clip = ManifestJson.Deserialize<ClipManifest>(await File.ReadAllTextAsync(clipManifestPath, cancellationToken));
            if (clip.Id.Value != clipId)
            {
                continue;
            }

            deletedManifestPath = relativeManifestPath;
            deletedClipRoot = Path.GetDirectoryName(clipManifestPath);
            break;
        }

        if (deletedManifestPath is null || deletedClipRoot is null)
        {
            throw new KeyNotFoundException("Clip was not found.");
        }

        character.ClipManifestPaths.Remove(deletedManifestPath);
        await WriteManifestAsync(characterManifestPath, character, cancellationToken);

        var fullCharacterRoot = Path.GetFullPath(characterRoot);
        var fullClipRoot = Path.GetFullPath(deletedClipRoot);
        if (fullClipRoot.StartsWith(fullCharacterRoot, StringComparison.Ordinal) && Directory.Exists(fullClipRoot))
        {
            Directory.Delete(fullClipRoot, recursive: true);
        }

        return await ToCharacterResponseAsync(reference, cancellationToken);
    }

    private async Task<WorkspaceManifest> EnsureWorkspaceManifestAsync(CancellationToken cancellationToken)
    {
        await CreateOrOpenBrowserWorkspaceAsync(cancellationToken);
        return ManifestJson.Deserialize<WorkspaceManifest>(await File.ReadAllTextAsync(GetWorkspaceManifestPath(), cancellationToken));
    }

    private async Task<WorkspaceResponse> ToResponseAsync(WorkspaceManifest workspace, CancellationToken cancellationToken)
    {
        var characters = new List<CharacterResponse>();
        foreach (var reference in workspace.Characters)
        {
            var manifestPath = Path.Combine(GetWorkspaceRoot(), reference.ManifestPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(manifestPath))
            {
                continue;
            }

            characters.Add(await ToCharacterResponseAsync(reference, cancellationToken));
        }

        return new WorkspaceResponse(
            workspace.Id.Value,
            workspace.Name,
            "browser",
            characters);
    }

    private async Task<CharacterResponse> ToCharacterResponseAsync(
        CharacterReference reference,
        CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(GetWorkspaceRoot(), reference.ManifestPath.Replace('/', Path.DirectorySeparatorChar));
        var manifest = ManifestJson.Deserialize<CharacterManifest>(await File.ReadAllTextAsync(manifestPath, cancellationToken));
        var characterRoot = Path.GetDirectoryName(manifestPath) ?? GetWorkspaceRoot();
        var sourcePath = Path.Combine(characterRoot, "Visual", "source.fbx");
        var previewPath = PreviewGlbCacheService.GetDefaultPreviewPath(characterRoot);
        var validation = File.Exists(sourcePath)
            ? ToValidationResponse(await _visualInspector.InspectAsync(sourcePath, cancellationToken))
            : null;
        var clips = await ReadClipResponsesAsync(characterRoot, manifest, cancellationToken);
        var previewUrl = File.Exists(previewPath) ? ToAssetUrl(reference.ManifestPath.Split('/')[0], Path.GetFileName(characterRoot), "Cache", "Preview", "visual.glb") : null;
        var importLog = BuildCharacterImportLog(manifest, validation, previewUrl, clips.Count);

        return new CharacterResponse(
            manifest.Id.Value,
            manifest.Name,
            reference.ManifestPath,
            manifest.VisualManifestPath,
            clips,
            previewUrl,
            validation,
            importLog);
    }

    private async Task<IReadOnlyList<ClipResponse>> ReadClipResponsesAsync(
        string characterRoot,
        CharacterManifest character,
        CancellationToken cancellationToken)
    {
        var clips = new List<ClipResponse>();
        foreach (var relativeManifestPath in character.ClipManifestPaths)
        {
            var clipManifestPath = Path.Combine(characterRoot, relativeManifestPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(clipManifestPath))
            {
                continue;
            }

            var clip = ManifestJson.Deserialize<ClipManifest>(await File.ReadAllTextAsync(clipManifestPath, cancellationToken));
            var clipRoot = Path.GetDirectoryName(clipManifestPath) ?? characterRoot;
            var sourcePath = Path.Combine(clipRoot, clip.ManagedSourcePath.Replace('/', Path.DirectorySeparatorChar));
            var updatedClip = await PopulateClipTimelineMetadataAsync(clip, sourcePath, cancellationToken);
            if (updatedClip != clip)
            {
                clip = updatedClip;
                await WriteManifestAsync(clipManifestPath, clip, cancellationToken);
            }

            var previewUrl = await TryGenerateClipPreviewUrlAsync(
                characterRoot,
                relativeManifestPath,
                clip,
                sourcePath,
                cancellationToken);
            var rootMotion = previewUrl is not null
                ? TryReadRootMotionDiagnostics(GetClipPreviewPath(clipRoot))
                : null;
            var skeletonValidation = await ValidateClipSkeletonAsync(characterRoot, clip, sourcePath, cancellationToken);
            var importLog = BuildClipImportLog(clip, previewUrl, rootMotion, skeletonValidation);

            clips.Add(new ClipResponse(
                clip.Id.Value,
                clip.Name,
                relativeManifestPath,
                clip.SourceKind.ToString().ToLowerInvariant(),
                clip.SourceFileName,
                clip.FrameCount,
                clip.FrameRate,
                clip.DurationSeconds,
                previewUrl,
                clip.IncludeInBuild,
                rootMotion,
                skeletonValidation.Validation,
                skeletonValidation.Skeleton,
                importLog));
        }

        return clips;
    }

    private async Task<ClipSkeletonValidationResult> ValidateClipSkeletonAsync(
        string characterRoot,
        ClipManifest clip,
        string sourcePath,
        CancellationToken cancellationToken)
    {
        var visualSourcePath = Path.Combine(characterRoot, "Visual", "source.fbx");
        var visualSkeleton = await _skeletonNameExtractor.ExtractAsync(visualSourcePath, ClipSourceKind.Fbx, cancellationToken);
        var clipSkeleton = await _skeletonNameExtractor.ExtractAsync(sourcePath, clip.SourceKind, cancellationToken);
        var findings = new List<ValidationFindingResponse>();

        if (!visualSkeleton.Succeeded)
        {
            findings.Add(new ValidationFindingResponse(
                "visual_skeleton_unavailable",
                "warning",
                $"Visual skeleton could not be inspected: {visualSkeleton.Error}"));
        }

        if (!clipSkeleton.Succeeded)
        {
            findings.Add(new ValidationFindingResponse(
                "clip_skeleton_unavailable",
                "warning",
                $"Clip skeleton could not be inspected: {clipSkeleton.Error}"));
        }

        if (!visualSkeleton.Succeeded || !clipSkeleton.Succeeded)
        {
            return new ClipSkeletonValidationResult(new ValidationResponse(true, findings), null);
        }

        var visualBones = NormalizeBoneNames(visualSkeleton.BoneNames);
        var clipBones = NormalizeBoneNames(clipSkeleton.BoneNames);
        if (visualBones.Count == 0 || clipBones.Count == 0)
        {
            findings.Add(new ValidationFindingResponse(
                "empty_skeleton",
                "warning",
                "Visual or clip skeleton has no named bones to compare."));
            return new ClipSkeletonValidationResult(new ValidationResponse(true, findings), null);
        }

        var matchedBones = visualBones.Where(clipBones.Contains).Order(StringComparer.Ordinal).ToArray();
        var matchedCount = matchedBones.Length;
        var visualOnlyBones = visualBones.Except(clipBones).Order(StringComparer.Ordinal).ToArray();
        var clipOnlyBones = clipBones.Except(visualBones).Order(StringComparer.Ordinal).ToArray();
        var missingCriticalBones = new[] { "hips", "pelvis", "root", "spine", "head" }
            .Where(bone => !clipBones.Contains(bone))
            .ToArray();
        var coverage = matchedCount / (double)visualBones.Count;
        var skeleton = new SkeletonValidationResponse(
            visualBones.Count,
            clipBones.Count,
            matchedCount,
            coverage,
            missingCriticalBones,
            matchedBones.Take(12).ToArray(),
            visualOnlyBones.Take(12).ToArray(),
            clipOnlyBones.Take(12).ToArray());

        if (matchedCount == 0)
        {
            findings.Add(new ValidationFindingResponse(
                "skeleton_unmatched",
                "error",
                "Clip skeleton has no matching bone names with the visual skeleton."));
            return new ClipSkeletonValidationResult(new ValidationResponse(false, findings), skeleton);
        }

        if (coverage < 0.65)
        {
            findings.Add(new ValidationFindingResponse(
                "skeleton_partial_match",
                "warning",
                $"Clip skeleton matches {matchedCount}/{visualBones.Count} visual bones."));
        }

        if (!clipBones.Contains("hips") && !clipBones.Contains("pelvis") && !clipBones.Contains("root"))
        {
            findings.Add(new ValidationFindingResponse(
                "root_motion_source_missing",
                "warning",
                "Clip skeleton has no obvious Hips/Pelvis/Root bone for root motion preview."));
        }

        return new ClipSkeletonValidationResult(
            new ValidationResponse(!findings.Any(finding => finding.Severity == "error"), findings),
            skeleton);
    }

    private async Task<string?> TryGenerateClipPreviewUrlAsync(
        string characterRoot,
        string relativeManifestPath,
        ClipManifest clip,
        string sourcePath,
        CancellationToken cancellationToken)
    {
        if (clip.SourceKind != ClipSourceKind.Fbx || !File.Exists(sourcePath))
        {
            return null;
        }

        var clipRoot = Path.GetDirectoryName(sourcePath) ?? characterRoot;
        var previewPath = GetClipPreviewPath(clipRoot);
        var result = await _previewCache.GenerateAsync(sourcePath, previewPath, cancellationToken);
        if (!result.Succeeded || !File.Exists(previewPath))
        {
            return null;
        }

        var characterFolderName = Path.GetFileName(characterRoot);
        var clipRelativeRoot = Path.GetDirectoryName(relativeManifestPath)?.Replace('\\', '/') ?? string.Empty;
        return ToAssetUrl("Characters", characterFolderName, clipRelativeRoot, "Cache", "Preview", "clip.glb");
    }

    private static string GetClipPreviewPath(string clipRoot)
    {
        return Path.Combine(clipRoot, "Cache", "Preview", "clip.glb");
    }

    private static RootMotionDiagnosticsResponse? TryReadRootMotionDiagnostics(string previewPath)
    {
        if (!File.Exists(previewPath))
        {
            return null;
        }

        try
        {
            var diagnostics = GltfRootMotionDiagnosticsParser.ParseGlb(previewPath);
            return diagnostics is null
                ? null
                : new RootMotionDiagnosticsResponse(
                    diagnostics.SourceName,
                    diagnostics.KeyCount,
                    diagnostics.DurationSeconds,
                    diagnostics.DisplacementX,
                    diagnostics.DisplacementY,
                    diagnostics.DisplacementZ,
                    diagnostics.HorizontalDistance,
                    diagnostics.AverageHorizontalSpeed);
        }
        catch
        {
            return null;
        }
    }

    private async Task<ClipManifest> PopulateClipTimelineMetadataAsync(
        ClipManifest clip,
        string sourcePath,
        CancellationToken cancellationToken)
    {
        if (clip.FrameCount is not null && clip.FrameRate is not null && clip.DurationSeconds is not null)
        {
            return clip;
        }

        var timeline = clip.SourceKind == ClipSourceKind.Bvh
            ? TryReadBvhTimelineMetadata(sourcePath)
            : await _clipTimelineExtractor.ExtractAsync(sourcePath, cancellationToken);
        if (timeline is null)
        {
            return clip;
        }

        return clip with
        {
            FrameCount = timeline.FrameCount,
            FrameRate = timeline.FrameRate,
            DurationSeconds = timeline.DurationSeconds
        };
    }

    private static HashSet<string> NormalizeBoneNames(IEnumerable<string> boneNames)
    {
        return boneNames
            .Select(NormalizeBoneName)
            .Where(name => name.Length > 0)
            .ToHashSet(StringComparer.Ordinal);
    }

    private static string NormalizeBoneName(string name)
    {
        var normalized = name.Trim().ToLowerInvariant();
        foreach (var prefix in new[] { "mixamorig:", "mixamorig_", "armature|", "armature/" })
        {
            if (normalized.StartsWith(prefix, StringComparison.Ordinal))
            {
                normalized = normalized[prefix.Length..];
            }
        }

        return normalized.Replace(" ", string.Empty, StringComparison.Ordinal);
    }

    private static ClipTimelineMetadata? TryReadBvhTimelineMetadata(string sourcePath)
    {
        int? frameCount = null;
        double? frameTimeSeconds = null;

        foreach (var line in File.ReadLines(sourcePath).Take(4096))
        {
            var trimmed = line.Trim();
            if (frameCount is null && trimmed.StartsWith("Frames:", StringComparison.OrdinalIgnoreCase))
            {
                var value = trimmed["Frames:".Length..].Trim();
                if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedFrameCount) && parsedFrameCount > 0)
                {
                    frameCount = parsedFrameCount;
                }
            }

            if (frameTimeSeconds is null && trimmed.StartsWith("Frame Time:", StringComparison.OrdinalIgnoreCase))
            {
                var value = trimmed["Frame Time:".Length..].Trim();
                if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedFrameTime) && parsedFrameTime > 0)
                {
                    frameTimeSeconds = parsedFrameTime;
                }
            }

            if (frameCount is not null && frameTimeSeconds is not null)
            {
                break;
            }
        }

        if (frameCount is null || frameTimeSeconds is null)
        {
            return null;
        }

        return new ClipTimelineMetadata(
            frameCount.Value,
            1.0 / frameTimeSeconds.Value,
            frameCount.Value * frameTimeSeconds.Value);
    }

    private static IReadOnlyList<ImportLogEntryResponse> BuildCharacterImportLog(
        CharacterManifest character,
        ValidationResponse? validation,
        string? previewUrl,
        int clipCount)
    {
        var entries = new List<ImportLogEntryResponse>
        {
            Info($"Loaded character {character.Name}"),
            previewUrl is null ? Warning("Character preview GLB is unavailable") : Info("Character preview GLB is ready"),
            Info($"{clipCount} clip(s) attached")
        };

        if (validation is null)
        {
            entries.Add(Warning("Visual validation has not run"));
        }
        else
        {
            entries.AddRange(validation.Findings.Select(ToLogEntry));
            if (validation.Findings.Count == 0)
            {
                entries.Add(Info("Visual validation has no findings"));
            }
        }

        return entries;
    }

    private static IReadOnlyList<ImportLogEntryResponse> BuildClipImportLog(
        ClipManifest clip,
        string? previewUrl,
        RootMotionDiagnosticsResponse? rootMotion,
        ClipSkeletonValidationResult skeletonValidation)
    {
        var entries = new List<ImportLogEntryResponse>
        {
            Info($"Loaded {clip.SourceKind.ToString().ToUpperInvariant()} source {clip.SourceFileName}")
        };

        if (clip.FrameCount is not null && clip.FrameRate is not null && clip.DurationSeconds is not null)
        {
            entries.Add(Info($"Timeline: {clip.FrameCount} frames at {clip.FrameRate:0.##} fps"));
        }
        else
        {
            entries.Add(Warning("Timeline metadata is unavailable"));
        }

        entries.Add(previewUrl is null ? Warning("Animation preview GLB is unavailable") : Info("Animation preview GLB is ready"));
        entries.Add(rootMotion is null
            ? Warning("Root motion diagnostics are unavailable")
            : Info($"Root motion: {rootMotion.SourceName}, XZ {rootMotion.HorizontalDistance:0.##} units"));

        if (skeletonValidation.Skeleton is null)
        {
            entries.Add(Warning("Skeleton coverage could not be calculated"));
        }
        else
        {
            entries.Add(Info($"Skeleton match: {skeletonValidation.Skeleton.MatchedBoneCount}/{skeletonValidation.Skeleton.VisualBoneCount} visual bones"));
        }

        entries.AddRange(skeletonValidation.Validation.Findings.Select(ToLogEntry));
        if (skeletonValidation.Validation.Findings.Count == 0)
        {
            entries.Add(Info("Clip validation has no findings"));
        }

        return entries;
    }

    private static ImportLogEntryResponse ToLogEntry(ValidationFindingResponse finding)
    {
        return new ImportLogEntryResponse(finding.Severity, $"{finding.Code}: {finding.Message}");
    }

    private static ImportLogEntryResponse Info(string message)
    {
        return new ImportLogEntryResponse("info", message);
    }

    private static ImportLogEntryResponse Warning(string message)
    {
        return new ImportLogEntryResponse("warning", message);
    }

    private static ImportLogEntryResponse Error(string message)
    {
        return new ImportLogEntryResponse("error", message);
    }

    private string ReserveCharacterFolderName(string requestedName)
    {
        var baseName = SanitizeFolderName(requestedName);
        var charactersRoot = Path.Combine(GetWorkspaceRoot(), "Characters");
        Directory.CreateDirectory(charactersRoot);

        var candidate = baseName;
        var suffix = 2;
        while (Directory.Exists(Path.Combine(charactersRoot, candidate)))
        {
            candidate = $"{baseName}_{suffix}";
            suffix++;
        }

        return candidate;
    }

    private static string ReserveClipFolderName(string characterRoot, string requestedName)
    {
        var baseName = SanitizeFolderName(requestedName);
        var clipsRoot = Path.Combine(characterRoot, "Clips");
        Directory.CreateDirectory(clipsRoot);

        var candidate = baseName;
        var suffix = 2;
        while (Directory.Exists(Path.Combine(clipsRoot, candidate)))
        {
            candidate = $"{baseName}_{suffix}";
            suffix++;
        }

        return candidate;
    }

    private static string SanitizeFolderName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? "Character" : cleaned;
    }

    private string GetWorkspaceRoot()
    {
        return Path.GetFullPath(_options.WorkspaceRoot);
    }

    private string GetWorkspaceManifestPath()
    {
        return Path.Combine(GetWorkspaceRoot(), WorkspaceFileName);
    }

    private static async Task WriteManifestAsync<T>(string path, T manifest, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new InvalidOperationException($"Path has no directory: {path}"));
        await File.WriteAllTextAsync(path, ManifestJson.Serialize(manifest), cancellationToken);
    }

    private static string ToPortablePath(params string[] parts)
    {
        return string.Join('/', parts);
    }

    private static string ToAssetUrl(params string[] parts)
    {
        return "/api/v1/workspaces/browser/assets/" + ToPortablePath(parts);
    }

    private static ValidationResponse ToValidationResponse(VisualFbxImportResult result)
    {
        return new ValidationResponse(
            result.CanCompile,
            result.Findings.Select(finding => new ValidationFindingResponse(
                finding.Code,
                finding.Severity.ToString().ToLowerInvariant(),
                finding.Message)).ToArray());
    }

    private sealed record ClipSkeletonValidationResult(
        ValidationResponse Validation,
        SkeletonValidationResponse? Skeleton);
}
