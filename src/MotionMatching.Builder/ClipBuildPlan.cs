using MotionMatching.Authoring;

namespace MotionMatching.Builder;

public sealed record ClipBuildEntry(
    string SourceClipId,
    string Name,
    bool IsMirrored);

public static class ClipBuildPlan
{
    public static IReadOnlyList<ClipBuildEntry> ExpandIncludedClips(IEnumerable<ClipManifest> clips)
    {
        var entries = new List<ClipBuildEntry>();
        foreach (var clip in clips)
        {
            if (!clip.IncludeInBuild)
            {
                continue;
            }

            entries.Add(new ClipBuildEntry(clip.Id.Value, clip.Name, false));
            if (clip.MirrorInBuild)
            {
                entries.Add(new ClipBuildEntry(clip.Id.Value, $"{clip.Name} Mirror", true));
            }
        }

        return entries;
    }
}
