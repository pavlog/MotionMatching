namespace MotionMatching.PreviewRuntime;

public sealed record PreviewGlbCacheResult(
    bool Succeeded,
    string PreviewFilePath,
    bool Generated,
    string? Error);
