namespace MotionMatching.Importers;

public interface IClipTimelineExtractor
{
    Task<ClipTimelineMetadata?> ExtractAsync(string assetPath, CancellationToken cancellationToken = default);
}
