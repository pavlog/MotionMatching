namespace MotionMatching.Importers;

public sealed record VisualSceneInspection
{
    public bool ImportSucceeded { get; init; } = true;

    public string? ImportError { get; init; }

    public IReadOnlyList<SkinnedMeshSummary> SkinnedMeshes { get; init; } = [];

    public IReadOnlyList<SkeletonSummary> Skeletons { get; init; } = [];

    public bool HasMaterials { get; init; }

    public bool HasTextures { get; init; }

    public static VisualSceneInspection Failed(string error)
    {
        return new VisualSceneInspection
        {
            ImportSucceeded = false,
            ImportError = error
        };
    }
}

public sealed record SkinnedMeshSummary(
    string Name,
    int VertexCount,
    int BoneCount,
    bool HasBindPose);

public sealed record SkeletonSummary(
    string RootBoneName,
    int BoneCount);
