namespace MotionMatching.Importers;

public sealed record SkeletonNameExtractionResult(
    bool Succeeded,
    IReadOnlyList<string> BoneNames,
    string? Error)
{
    public static SkeletonNameExtractionResult Success(IReadOnlyList<string> boneNames)
    {
        return new SkeletonNameExtractionResult(true, boneNames, null);
    }

    public static SkeletonNameExtractionResult Failed(string error)
    {
        return new SkeletonNameExtractionResult(false, [], error);
    }
}
