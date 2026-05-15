namespace MotionMatching.Importers;

public sealed record VisualFbxImportResult
{
    public required bool CanCompile { get; init; }

    public required VisualSceneInspection Scene { get; init; }

    public IReadOnlyList<ImporterFinding> Findings { get; init; } = [];
}
