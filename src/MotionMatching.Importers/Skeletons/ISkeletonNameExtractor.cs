using MotionMatching.Authoring;

namespace MotionMatching.Importers;

public interface ISkeletonNameExtractor
{
    Task<SkeletonNameExtractionResult> ExtractAsync(
        string assetPath,
        ClipSourceKind sourceKind,
        CancellationToken cancellationToken = default);
}
