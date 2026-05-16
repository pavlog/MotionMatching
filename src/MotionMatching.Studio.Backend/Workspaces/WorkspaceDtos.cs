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
    BuildReadinessResponse BuildReadiness,
    string? BuildReportPath,
    string BuildReportStatus,
    string? RuntimeBuildDraftPath,
    string RuntimeBuildDraftStatus,
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
    bool MirrorInBuild,
    string ContactDetectionPreset,
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

public sealed record BuildReadinessResponse(
    int IncludedClipCount,
    int MirroredCopyCount,
    int PlannedClipCount,
    int WarningCount,
    int ErrorCount,
    IReadOnlyList<BuildRoleCoverageResponse> Roles,
    IReadOnlyList<BuildPlanEntryResponse> PlanEntries,
    IReadOnlyList<BuildSkeletonCoverageResponse> SkeletonCoverage,
    IReadOnlyList<BuildFootContactCoverageResponse> FootContacts,
    IReadOnlyList<BuildReadinessFindingResponse> Findings);

public sealed record BuildRoleCoverageResponse(
    string Role,
    string Description,
    bool IsRequired,
    int IncludedClipCount);

public sealed record BuildPlanEntryResponse(
    string ClipId,
    string ClipName,
    string? ClipRole,
    bool IsMirrored);

public sealed record BuildSkeletonCoverageResponse(
    string ClipId,
    string ClipName,
    double? Coverage,
    int? MatchedBoneCount,
    int? VisualBoneCount,
    string Status);

public sealed record BuildFootContactCoverageResponse(
    string ClipId,
    string ClipName,
    bool HasContacts,
    int RangeCount,
    IReadOnlyList<string> PresentFeet,
    IReadOnlyList<string> MissingFeet);

public sealed record BuildReadinessFindingResponse(
    string Severity,
    string Code,
    string Message,
    string? ClipId,
    string? ClipName);

public sealed record BuildReportResponse(
    string CharacterId,
    string CharacterName,
    string ReportPath,
    DateTimeOffset GeneratedAtUtc,
    string ReadinessFingerprint,
    BuildReadinessResponse BuildReadiness);

public sealed record RuntimeBuildDraftResponse(
    string CharacterId,
    string CharacterName,
    string DraftPath,
    DateTimeOffset GeneratedAtUtc,
    string SourceReportPath,
    IReadOnlyList<string> FeaturePreset,
    IReadOnlyList<RuntimeBuildArtifactResponse> Artifacts,
    RuntimeSkeletonDraftResponse Skeleton,
    RuntimePoseDraftResponse Poses,
    RuntimeFeatureDraftResponse Features,
    BuildReadinessResponse BuildReadiness);

public sealed record RuntimeBuildArtifactResponse(
    string FileName,
    string Kind,
    string Status);

public sealed record RuntimeSkeletonDraftResponse(
    string Status,
    string? RootBoneName,
    int BoneCount,
    IReadOnlyList<string> BoneNames,
    IReadOnlyList<RuntimeSkeletonSlotResponse> Slots,
    IReadOnlyList<BuildReadinessFindingResponse> Findings);

public sealed record RuntimeSkeletonSlotResponse(
    string Slot,
    string? BoneName,
    string Status);

public sealed record RuntimePoseDraftResponse(
    string Status,
    int ClipCount,
    int PlannedPoseSampleCount,
    IReadOnlyList<RuntimePoseClipDraftResponse> Clips,
    IReadOnlyList<BuildReadinessFindingResponse> Findings);

public sealed record RuntimePoseClipDraftResponse(
    string ClipId,
    string ClipName,
    string? ClipRole,
    bool IsMirrored,
    int? FrameCount,
    double? FrameRate,
    double? DurationSeconds,
    int PlannedSampleCount);

public sealed record RuntimeFeatureDraftResponse(
    string Status,
    int FeatureCount,
    int PlannedSampleCount,
    IReadOnlyList<RuntimeFeatureChannelResponse> Channels,
    IReadOnlyList<RuntimeFeatureClipResponse> Clips,
    IReadOnlyList<BuildReadinessFindingResponse> Findings);

public sealed record RuntimeFeatureChannelResponse(
    string Name,
    string Kind,
    string? BoneSlot,
    IReadOnlyList<int> TrajectoryFrames);

public sealed record RuntimeFeatureClipResponse(
    string ClipId,
    string ClipName,
    bool IsMirrored,
    int PlannedSampleCount);

public sealed record ImportLogEntryResponse(
    string Level,
    string Message);

public sealed record ClipSettingsRequest(
    bool IncludeInBuild,
    bool MirrorInBuild,
    string? ClipRole,
    string? ContactDetectionPreset,
    IReadOnlyList<string> Tags);
