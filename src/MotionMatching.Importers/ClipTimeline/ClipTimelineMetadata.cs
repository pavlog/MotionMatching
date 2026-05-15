namespace MotionMatching.Importers;

public sealed record ClipTimelineMetadata(
    int FrameCount,
    double FrameRate,
    double DurationSeconds);
