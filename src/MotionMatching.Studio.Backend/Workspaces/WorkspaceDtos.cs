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
    ValidationResponse? Validation,
    IReadOnlyList<ImportLogEntryResponse> ImportLog);

public sealed record ClipResponse(
    string Id,
    string Name,
    string ManifestPath,
    string SourceKind,
    string SourceFileName,
    string? ClipRole,
    IReadOnlyList<string> Tags,
    int? FrameCount,
    double? FrameRate,
    double? DurationSeconds,
    string? PreviewUrl,
    bool IncludeInBuild,
    RootMotionDiagnosticsResponse? RootMotion,
    FootContactDiagnosticsResponse? FootContacts,
    ValidationResponse? Validation,
    SkeletonValidationResponse? Skeleton,
    IReadOnlyList<ImportLogEntryResponse> ImportLog);

public sealed record RootMotionDiagnosticsResponse(
    string SourceName,
    int KeyCount,
    double DurationSeconds,
    double DisplacementX,
    double DisplacementY,
    double DisplacementZ,
    double HorizontalDistance,
    double AverageHorizontalSpeed);

public sealed record FootContactDiagnosticsResponse(
    double VelocityThreshold,
    IReadOnlyList<FootContactTrackResponse> Tracks);

public sealed record FootContactTrackResponse(
    string Foot,
    string SourceName,
    int KeyCount,
    IReadOnlyList<FootContactRangeResponse> Ranges);

public sealed record FootContactRangeResponse(
    int StartFrame,
    int EndFrame,
    double StartSeconds,
    double EndSeconds);

public sealed record ValidationResponse(
    bool CanCompile,
    IReadOnlyList<ValidationFindingResponse> Findings);

public sealed record ValidationFindingResponse(
    string Code,
    string Severity,
    string Message);

public sealed record SkeletonValidationResponse(
    int VisualBoneCount,
    int ClipBoneCount,
    int MatchedBoneCount,
    double Coverage,
    IReadOnlyList<string> MissingCriticalBones,
    IReadOnlyList<string> MatchedBones,
    IReadOnlyList<string> VisualOnlyBones,
    IReadOnlyList<string> ClipOnlyBones);

public sealed record ImportLogEntryResponse(
    string Level,
    string Message);

public sealed record ClipSettingsRequest(
    bool IncludeInBuild,
    string? ClipRole,
    IReadOnlyList<string> Tags);
