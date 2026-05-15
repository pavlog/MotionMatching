namespace MotionMatching.Studio.Backend.Workspaces;

public sealed record WorkspaceResponse(
    string Id,
    string Name,
    string Mode,
    IReadOnlyList<CharacterResponse> Characters);

public sealed record CharacterResponse(
    string Id,
    string Name,
    string ManifestPath,
    string VisualManifestPath,
    IReadOnlyList<ClipResponse> Clips,
    string? PreviewUrl,
    ValidationResponse? Validation);

public sealed record ClipResponse(
    string Id,
    string Name,
    string ManifestPath,
    string SourceKind,
    string SourceFileName,
    int? FrameCount,
    double? FrameRate,
    double? DurationSeconds,
    string? PreviewUrl,
    bool IncludeInBuild);

public sealed record ValidationResponse(
    bool CanCompile,
    IReadOnlyList<ValidationFindingResponse> Findings);

public sealed record ValidationFindingResponse(
    string Code,
    string Severity,
    string Message);
