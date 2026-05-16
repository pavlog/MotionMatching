using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using MotionMatching.Authoring;
using MotionMatching.Importers;
using MotionMatching.PreviewRuntime;

namespace MotionMatching.Studio.Backend.Workspaces;

public sealed class BrowserWorkspaceService
{
    private const string WorkspaceFileName = "workspace.json";
    private static readonly string[] RuntimeDraftFeaturePreset =
    [
        "trajectory_position[20,40,60]:simulation_bone",
        "trajectory_direction[20,40,60]:simulation_bone",
        "left_foot_position",
        "left_foot_velocity",
        "right_foot_position",
        "right_foot_velocity",
        "hips_velocity"
    ];

    private static readonly IReadOnlyList<ClipRoleDefinition> ClipRoleDefinitions =
    [
        new("idle_loop", "no movement input"),
        new("walk_loop", "moving slowly"),
        new("run_loop", "moving fast"),
        new("turn_left", "committed left turn"),
        new("turn_right", "committed right turn"),
        new("turn_left_180", "reversing left"),
        new("turn_right_180", "reversing right"),
        new("jump", "jump begins"),
        new("fall_loop", "airborne or falling"),
        new("land", "landing")
    ];

    private static readonly HashSet<string> KnownClipRoles = new(
        ClipRoleDefinitions.Select(role => role.Value),
        StringComparer.Ordinal);

    private static readonly HashSet<string> RequiredBuildRoles = new(KnownClipRoles, StringComparer.Ordinal);

    private static readonly string[] BuildFootSides =
    {
        "left",
        "right"
    };

    private static readonly IReadOnlyDictionary<string, string?> LegacyClipRoleAliases = new Dictionary<string, string?>(StringComparer.Ordinal)
    {
        ["start"] = null,
        ["stop"] = null,
        ["walk_start"] = null,
        ["run_start"] = null,
        ["walk_stop"] = null,
        ["run_stop"] = null,
        ["turn_180"] = "turn_right_180",
        ["run_turn_180"] = "turn_right_180",
        ["jump_up"] = "jump",
        ["jump_forward_standing"] = "jump",
        ["jump_forward_run"] = "jump",
        ["jump_turn"] = "jump",
        ["land_soft"] = "land",
        ["land_run"] = "land",
        ["land_medium"] = "land",
        ["land_hard"] = "land"
    };

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
            BuildReadiness([], ToValidationResponse(validation)),
            null,
            "none",
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

    public async Task<WorkspaceResponse> DeleteCharacterAsync(
        string characterId,
        CancellationToken cancellationToken)
    {
        var workspace = await EnsureWorkspaceManifestAsync(cancellationToken);
        var reference = workspace.Characters.FirstOrDefault(character => character.Id.Value == characterId)
            ?? throw new KeyNotFoundException("Character was not found.");

        workspace.Characters.Remove(reference);
        await WriteManifestAsync(GetWorkspaceManifestPath(), workspace, cancellationToken);

        var charactersRoot = Path.GetFullPath(Path.Combine(GetWorkspaceRoot(), "Characters"));
        var characterManifestPath = Path.GetFullPath(Path.Combine(GetWorkspaceRoot(), reference.ManifestPath.Replace('/', Path.DirectorySeparatorChar)));
        var characterRoot = Path.GetDirectoryName(characterManifestPath);
        if (characterRoot is not null)
        {
            var fullCharacterRoot = Path.GetFullPath(characterRoot);
            if (!fullCharacterRoot.Equals(charactersRoot, StringComparison.OrdinalIgnoreCase) &&
                fullCharacterRoot.StartsWith(charactersRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) &&
                Directory.Exists(fullCharacterRoot))
            {
                Directory.Delete(fullCharacterRoot, recursive: true);
            }
        }

        return await ToResponseAsync(workspace, cancellationToken);
    }

    public async Task<CharacterResponse> ReplaceClipSourceAsync(
        string characterId,
        string clipId,
        IFormFile clipFile,
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

            var clipRoot = Path.GetDirectoryName(clipManifestPath) ?? throw new InvalidOperationException("Clip manifest path has no directory.");
            var extension = Path.GetExtension(clipFile.FileName).ToLowerInvariant();
            var sourcePath = Path.Combine(clipRoot, $"source{extension}");
            var updatedClip = ClipManifest.FromUploadedSource(
                clip.Id,
                clip.Name,
                clipFile.FileName,
                clipFile.Length) with
            {
                ImportedAtUtc = DateTimeOffset.UtcNow,
                IncludeInBuild = clip.IncludeInBuild,
                MirrorInBuild = clip.MirrorInBuild,
                ContactDetectionPreset = clip.ContactDetectionPreset,
                ClipRole = NormalizeClipRole(clip.ClipRole),
                Tags = clip.Tags
            };

            var oldSourcePath = Path.Combine(clipRoot, clip.ManagedSourcePath.Replace('/', Path.DirectorySeparatorChar));
            if (!string.Equals(Path.GetFullPath(oldSourcePath), Path.GetFullPath(sourcePath), StringComparison.OrdinalIgnoreCase) &&
                File.Exists(oldSourcePath))
            {
                File.Delete(oldSourcePath);
            }

            await using (var stream = File.Create(sourcePath))
            await using (var input = clipFile.OpenReadStream())
            {
                await input.CopyToAsync(stream, cancellationToken);
            }

            updatedClip = await PopulateClipTimelineMetadataAsync(updatedClip, sourcePath, cancellationToken);
            ClearClipCache(clipRoot);
            await WriteManifestAsync(clipManifestPath, updatedClip, cancellationToken);
            return await ToCharacterResponseAsync(reference, cancellationToken);
        }

        throw new KeyNotFoundException("Clip was not found.");
    }

    public async Task<BuildReportResponse> GenerateBuildReportAsync(
        string characterId,
        CancellationToken cancellationToken)
    {
        var workspace = await EnsureWorkspaceManifestAsync(cancellationToken);
        var reference = workspace.Characters.FirstOrDefault(character => character.Id.Value == characterId)
            ?? throw new KeyNotFoundException("Character was not found.");

        var character = await ToCharacterResponseAsync(reference, cancellationToken);
        var reportPath = GetBuildReportPath(reference);
        var report = new BuildReportResponse(
            character.Id,
            character.Name,
            reportPath,
            DateTimeOffset.UtcNow,
            ComputeReadinessFingerprint(character.BuildReadiness),
            character.BuildReadiness);

        await WriteManifestAsync(
            Path.Combine(GetWorkspaceRoot(), reportPath.Replace('/', Path.DirectorySeparatorChar)),
            report,
            cancellationToken);

        return report;
    }

    public async Task<BuildReportResponse> GetBuildReportAsync(
        string characterId,
        CancellationToken cancellationToken)
    {
        var workspace = await EnsureWorkspaceManifestAsync(cancellationToken);
        var reference = workspace.Characters.FirstOrDefault(character => character.Id.Value == characterId)
            ?? throw new KeyNotFoundException("Character was not found.");

        var reportPath = GetBuildReportPath(reference);
        var fullReportPath = Path.Combine(GetWorkspaceRoot(), reportPath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(fullReportPath))
        {
            throw new FileNotFoundException("Build report was not found.", fullReportPath);
        }

        return ManifestJson.Deserialize<BuildReportResponse>(await File.ReadAllTextAsync(fullReportPath, cancellationToken));
    }

    public async Task<RuntimeBuildDraftResponse> GenerateRuntimeBuildDraftAsync(
        string characterId,
        CancellationToken cancellationToken)
    {
        var workspace = await EnsureWorkspaceManifestAsync(cancellationToken);
        var reference = workspace.Characters.FirstOrDefault(character => character.Id.Value == characterId)
            ?? throw new KeyNotFoundException("Character was not found.");

        var report = await GenerateBuildReportAsync(characterId, cancellationToken);
        var characterFolderName = GetCharacterFolderName(reference);
        var draftPath = GetRuntimeBuildDraftPath(reference);
        var draft = new RuntimeBuildDraftResponse(
            report.CharacterId,
            report.CharacterName,
            draftPath,
            DateTimeOffset.UtcNow,
            report.ReportPath,
            RuntimeDraftFeaturePreset,
            [
                new RuntimeBuildArtifactResponse($"{characterFolderName}.mmskeleton", "skeleton", "planned"),
                new RuntimeBuildArtifactResponse($"{characterFolderName}.mmpose", "poses", "planned"),
                new RuntimeBuildArtifactResponse($"{characterFolderName}.mmfeatures", "features", "planned")
            ],
            report.BuildReadiness);

        await WriteManifestAsync(
            Path.Combine(GetWorkspaceRoot(), draftPath.Replace('/', Path.DirectorySeparatorChar)),
            draft,
            cancellationToken);

        return draft;
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
        var buildReadiness = BuildReadiness(clips, validation);
        var buildReportPath = GetBuildReportPath(reference);
        var fullBuildReportPath = Path.Combine(GetWorkspaceRoot(), buildReportPath.Replace('/', Path.DirectorySeparatorChar));
        var buildReportStatus = GetBuildReportStatus(fullBuildReportPath, buildReadiness);

        return new CharacterResponse(
            manifest.Id.Value,
            manifest.Name,
            reference.ManifestPath,
            manifest.VisualManifestPath,
            clips,
            previewUrl,
            validation,
            buildReadiness,
            File.Exists(fullBuildReportPath) ? buildReportPath : null,
            buildReportStatus,
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
            var footContacts = previewUrl is not null
                ? TryReadFootContactDiagnostics(GetClipPreviewPath(clipRoot), clip.FrameCount, clip.DurationSeconds, clip.ContactDetectionPreset, ShouldAllowAlmostWholeClipFootContacts(clip, rootMotion))
                : null;
            var skeletonValidation = await ValidateClipSkeletonAsync(characterRoot, clip, sourcePath, cancellationToken);
            var importLog = BuildClipImportLog(clip, previewUrl, rootMotion, footContacts, skeletonValidation);

            clips.Add(new ClipResponse(
                clip.Id.Value,
                clip.Name,
                relativeManifestPath,
                clip.SourceKind.ToString().ToLowerInvariant(),
                clip.SourceFileName,
                NormalizeClipRole(clip.ClipRole),
                clip.Tags,
                clip.FrameCount,
                clip.FrameRate,
                clip.DurationSeconds,
                previewUrl,
                clip.IncludeInBuild,
                clip.MirrorInBuild,
                ToSerializedContactDetectionPreset(clip.ContactDetectionPreset),
                rootMotion,
                footContacts,
                skeletonValidation.Validation,
                skeletonValidation.Skeleton,
                importLog));
        }

        return clips;
    }

    private static BuildReadinessResponse BuildReadiness(
        IReadOnlyList<ClipResponse> clips,
        ValidationResponse? characterValidation)
    {
        var includedClips = clips.Where(clip => clip.IncludeInBuild).ToArray();
        var findings = new List<BuildReadinessFindingResponse>();

        if (includedClips.Length == 0)
        {
            findings.Add(BuildFinding(
                "error",
                "no_included_clips",
                "Build plan has no included clips.",
                null));
        }

        if (characterValidation is null)
        {
            findings.Add(BuildFinding(
                "warning",
                "visual_validation_missing",
                "Visual validation has not run.",
                null));
        }
        else
        {
            findings.AddRange(characterValidation.Findings.Select(finding => BuildFinding(
                finding.Severity,
                $"visual_{finding.Code}",
                finding.Message,
                null)));
        }

        foreach (var clip in includedClips)
        {
            if (clip.ClipRole is null)
            {
                findings.Add(BuildFinding(
                    "warning",
                    "clip_role_missing",
                    $"{clip.Name} is included but has no role.",
                    clip));
            }

            if (clip.Validation is null)
            {
                findings.Add(BuildFinding(
                    "warning",
                    "clip_validation_missing",
                    $"{clip.Name} validation has not run.",
                    clip));
            }
            else
            {
                findings.AddRange(clip.Validation.Findings.Select(finding => BuildFinding(
                    finding.Severity,
                    finding.Code,
                    finding.Message,
                    clip)));
            }

            if (clip.Skeleton is null)
            {
                findings.Add(BuildFinding(
                    "warning",
                    "skeleton_coverage_missing",
                    $"{clip.Name} has no skeleton coverage diagnostics.",
                    clip));
            }

            var rangeCount = CountFootContactRanges(clip);
            if (rangeCount == 0)
            {
                findings.Add(BuildFinding(
                    "warning",
                    "foot_contacts_missing",
                    $"{clip.Name} has no detected foot contact ranges.",
                    clip));
            }
        }

        var missingRoles = RequiredBuildRoles
            .Where(role => !includedClips.Any(clip => clip.ClipRole == role))
            .ToArray();
        if (missingRoles.Length > 0)
        {
            findings.Add(BuildFinding(
                "warning",
                "role_coverage_missing",
                $"Missing included clips for roles: {string.Join(", ", missingRoles)}.",
                null));
        }

        var roleCoverage = ClipRoleDefinitions
            .Select(role => new BuildRoleCoverageResponse(
                role.Value,
                role.Description,
                RequiredBuildRoles.Contains(role.Value),
                includedClips.Count(clip => clip.ClipRole == role.Value)))
            .ToArray();

        var planEntries = includedClips
            .SelectMany(clip =>
            {
                var entries = new List<BuildPlanEntryResponse>
                {
                    new(clip.Id, clip.Name, clip.ClipRole, false)
                };
                if (clip.MirrorInBuild)
                {
                    entries.Add(new BuildPlanEntryResponse(clip.Id, $"{clip.Name} Mirror", clip.ClipRole, true));
                }

                return entries;
            })
            .ToArray();

        var skeletonCoverage = includedClips
            .Select(clip => new BuildSkeletonCoverageResponse(
                clip.Id,
                clip.Name,
                clip.Skeleton?.Coverage,
                clip.Skeleton?.MatchedBoneCount,
                clip.Skeleton?.VisualBoneCount,
                GetSkeletonCoverageStatus(clip)))
            .ToArray();

        var footContacts = includedClips
            .Select(clip =>
            {
                var presentFeet = clip.FootContacts?.Tracks
                    .Where(track => track.Ranges.Count > 0)
                    .Select(track => track.Foot)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Order(StringComparer.OrdinalIgnoreCase)
                    .ToArray() ?? [];
                var missingFeet = BuildFootSides
                    .Where(side => !presentFeet.Contains(side, StringComparer.OrdinalIgnoreCase))
                    .ToArray();

                return new BuildFootContactCoverageResponse(
                    clip.Id,
                    clip.Name,
                    presentFeet.Length > 0,
                    CountFootContactRanges(clip),
                    presentFeet,
                    missingFeet);
            })
            .ToArray();

        return new BuildReadinessResponse(
            includedClips.Length,
            includedClips.Count(clip => clip.MirrorInBuild),
            planEntries.Length,
            findings.Count(finding => finding.Severity == "warning"),
            findings.Count(finding => finding.Severity == "error"),
            roleCoverage,
            planEntries,
            skeletonCoverage,
            footContacts,
            findings);
    }

    private static BuildReadinessFindingResponse BuildFinding(
        string severity,
        string code,
        string message,
        ClipResponse? clip)
    {
        return new BuildReadinessFindingResponse(
            severity,
            code,
            message,
            clip?.Id,
            clip?.Name);
    }

    private static int CountFootContactRanges(ClipResponse clip)
    {
        return clip.FootContacts?.Tracks.Sum(track => track.Ranges.Count) ?? 0;
    }

    private static string GetSkeletonCoverageStatus(ClipResponse clip)
    {
        if (clip.Skeleton is null)
        {
            return "missing";
        }

        if (clip.Validation?.Findings.Any(finding => finding.Severity == "error" && finding.Code.Contains("skeleton", StringComparison.OrdinalIgnoreCase)) == true)
        {
            return "error";
        }

        if (clip.Validation?.Findings.Any(finding => finding.Severity == "warning" && finding.Code.Contains("skeleton", StringComparison.OrdinalIgnoreCase)) == true)
        {
            return "warning";
        }

        return "ok";
    }

    private static string GetBuildReportStatus(string fullReportPath, BuildReadinessResponse buildReadiness)
    {
        if (!File.Exists(fullReportPath))
        {
            return "none";
        }

        try
        {
            var report = ManifestJson.Deserialize<BuildReportResponse>(File.ReadAllText(fullReportPath));
            return string.Equals(report.ReadinessFingerprint, ComputeReadinessFingerprint(buildReadiness), StringComparison.Ordinal)
                ? "current"
                : "outdated";
        }
        catch
        {
            return "outdated";
        }
    }

    private static string ComputeReadinessFingerprint(BuildReadinessResponse buildReadiness)
    {
        var json = ManifestJson.Serialize(buildReadiness);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public async Task<CharacterResponse> UpdateClipSettingsAsync(
        string characterId,
        string clipId,
        ClipSettingsRequest request,
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

            var role = NormalizeClipRole(request.ClipRole);
            var contactDetectionPreset = NormalizeContactDetectionPreset(request.ContactDetectionPreset);
            var updatedClip = clip with
            {
                IncludeInBuild = request.IncludeInBuild,
                MirrorInBuild = request.MirrorInBuild,
                ClipRole = role,
                ContactDetectionPreset = contactDetectionPreset,
                Tags = NormalizeTags(request.Tags)
            };

            await WriteManifestAsync(clipManifestPath, updatedClip, cancellationToken);
            return await ToCharacterResponseAsync(reference, cancellationToken);
        }

        throw new KeyNotFoundException("Clip was not found.");
    }

    public async Task<CharacterResponse> RefreshClipFootContactsAsync(
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

        foreach (var relativeManifestPath in character.ClipManifestPaths)
        {
            var clipManifestPath = Path.Combine(characterRoot, relativeManifestPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(clipManifestPath))
            {
                continue;
            }

            var clip = ManifestJson.Deserialize<ClipManifest>(await File.ReadAllTextAsync(clipManifestPath, cancellationToken));
            if (clip.Id.Value == clipId)
            {
                return await ToCharacterResponseAsync(reference, cancellationToken);
            }
        }

        throw new KeyNotFoundException("Clip was not found.");
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

    private static void ClearClipCache(string clipRoot)
    {
        var cacheRoot = Path.Combine(clipRoot, "Cache");
        if (Directory.Exists(cacheRoot))
        {
            Directory.Delete(cacheRoot, recursive: true);
        }
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

    private static FootContactDiagnosticsResponse? TryReadFootContactDiagnostics(
        string previewPath,
        int? clipFrameCount,
        double? clipDurationSeconds,
        ContactDetectionPreset preset,
        bool allowAlmostWholeClipContacts)
    {
        if (!File.Exists(previewPath) || preset == ContactDetectionPreset.ManualOnly)
        {
            return null;
        }

        try
        {
            var diagnostics = GltfFootContactDiagnosticsParser.ParseGlb(
                previewPath,
                ResolveFootContactVelocityThreshold(preset),
                allowAlmostWholeClipContacts);
            return diagnostics is null
                ? null
                : new FootContactDiagnosticsResponse(
                    diagnostics.VelocityThreshold,
                    diagnostics.Tracks.Select(track => new FootContactTrackResponse(
                        track.Foot,
                        track.SourceName,
                        track.KeyCount,
                        track.Ranges.Select(range => new FootContactRangeResponse(
                            ToClipFrame(range.StartSeconds, clipFrameCount, clipDurationSeconds, range.StartFrame),
                            ToClipFrame(range.EndSeconds, clipFrameCount, clipDurationSeconds, range.EndFrame),
                            range.StartSeconds,
                            range.EndSeconds)).ToArray())).ToArray());
        }
        catch
        {
            return null;
        }
    }

    private static bool ShouldAllowAlmostWholeClipFootContacts(ClipManifest clip, RootMotionDiagnosticsResponse? rootMotion)
    {
        if (clip.ClipRole?.Equals("idle_loop", StringComparison.OrdinalIgnoreCase) == true ||
            clip.Tags.Any(tag => tag.Equals("idle", StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        return rootMotion is not null && rootMotion.AverageHorizontalSpeed < 0.2;
    }

    private static double ResolveFootContactVelocityThreshold(ContactDetectionPreset preset)
    {
        return preset switch
        {
            ContactDetectionPreset.CharacterScale => 0.15,
            ContactDetectionPreset.Strict => 7.5,
            ContactDetectionPreset.Loose => 30,
            ContactDetectionPreset.Auto or ContactDetectionPreset.SourceScale => 15,
            ContactDetectionPreset.ManualOnly => double.PositiveInfinity,
            _ => 15
        };
    }

    private static int ToClipFrame(double seconds, int? clipFrameCount, double? clipDurationSeconds, int fallbackFrame)
    {
        if (clipFrameCount is null || clipFrameCount <= 1 || clipDurationSeconds is null || clipDurationSeconds <= 0)
        {
            return fallbackFrame;
        }

        var maxFrame = clipFrameCount.Value - 1;
        return Math.Clamp((int)Math.Round(seconds / clipDurationSeconds.Value * maxFrame), 0, maxFrame);
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

    private static string? NormalizeClipRole(string? role)
    {
        if (string.IsNullOrWhiteSpace(role))
        {
            return null;
        }

        var normalized = NormalizeToken(role);
        if (LegacyClipRoleAliases.TryGetValue(normalized, out var alias))
        {
            if (alias is null)
            {
                return null;
            }

            normalized = alias;
        }

        if (!KnownClipRoles.Contains(normalized))
        {
            throw new ArgumentException($"Unknown clip role: {role}", nameof(role));
        }

        return normalized;
    }

    private static ContactDetectionPreset NormalizeContactDetectionPreset(string? preset)
    {
        if (string.IsNullOrWhiteSpace(preset))
        {
            return ContactDetectionPreset.Auto;
        }

        return NormalizeToken(preset) switch
        {
            "auto" => ContactDetectionPreset.Auto,
            "character_scale" => ContactDetectionPreset.CharacterScale,
            "source_scale" => ContactDetectionPreset.SourceScale,
            "strict" => ContactDetectionPreset.Strict,
            "loose" => ContactDetectionPreset.Loose,
            "manual_only" => ContactDetectionPreset.ManualOnly,
            _ => throw new ArgumentException($"Unknown contact detection preset: {preset}", nameof(preset))
        };
    }

    private static string ToSerializedContactDetectionPreset(ContactDetectionPreset preset)
    {
        return preset switch
        {
            ContactDetectionPreset.Auto => "auto",
            ContactDetectionPreset.CharacterScale => "character_scale",
            ContactDetectionPreset.SourceScale => "source_scale",
            ContactDetectionPreset.Strict => "strict",
            ContactDetectionPreset.Loose => "loose",
            ContactDetectionPreset.ManualOnly => "manual_only",
            _ => "auto"
        };
    }

    private static List<string> NormalizeTags(IEnumerable<string> tags)
    {
        return tags
            .Select(NormalizeToken)
            .Where(tag => tag.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();
    }

    private static string NormalizeToken(string value)
    {
        return value.Trim().ToLowerInvariant()
            .Replace(" ", "_", StringComparison.Ordinal)
            .Replace("-", "_", StringComparison.Ordinal);
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
        FootContactDiagnosticsResponse? footContacts,
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
        entries.Add(Info($"Foot contact preset: {ToSerializedContactDetectionPreset(clip.ContactDetectionPreset)}"));
        entries.Add(footContacts is null
            ? Warning("Foot contact diagnostics are unavailable")
            : Info($"Foot contacts: {footContacts.Tracks.Sum(track => track.Ranges.Count)} range(s) from {footContacts.Tracks.Count} foot track(s)"));

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

    private static string GetCharacterFolderName(CharacterReference reference)
    {
        var normalizedPath = reference.ManifestPath.Replace('\\', '/');
        var parts = normalizedPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 ? parts[^2] : SanitizeFolderName(reference.Name);
    }

    private static string GetBuildReportPath(CharacterReference reference)
    {
        return ToPortablePath("Builds", GetCharacterFolderName(reference), "build-report.json");
    }

    private static string GetRuntimeBuildDraftPath(CharacterReference reference)
    {
        return ToPortablePath("Builds", GetCharacterFolderName(reference), "runtime-build-draft.json");
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

    private sealed record ClipRoleDefinition(
        string Value,
        string Description);
}
