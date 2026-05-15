using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace MotionMatching.Importers;

public static class GltfAnimationTimelineParser
{
    private const uint GlbMagic = 0x46546C67;
    private const uint JsonChunkType = 0x4E4F534A;
    private const double DurationEpsilon = 0.000001;

    public static ClipTimelineMetadata? ParseGlb(string glbPath)
    {
        var bytes = File.ReadAllBytes(glbPath);
        if (bytes.Length < 20 || BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(0, 4)) != GlbMagic)
        {
            return null;
        }

        var jsonLength = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(12, 4)));
        var jsonType = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(16, 4));
        if (jsonType != JsonChunkType || bytes.Length < 20 + jsonLength)
        {
            return null;
        }

        var jsonText = Encoding.UTF8.GetString(bytes, 20, jsonLength).TrimEnd('\0', ' ', '\n', '\r', '\t');
        return ParseGltfJson(jsonText);
    }

    public static ClipTimelineMetadata? ParseGltfJson(string jsonText)
    {
        using var document = JsonDocument.Parse(jsonText);
        var root = document.RootElement;
        if (!root.TryGetProperty("animations", out var animations) || animations.ValueKind != JsonValueKind.Array ||
            !root.TryGetProperty("accessors", out var accessors) || accessors.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var candidates = new List<ClipTimelineMetadata>();
        foreach (var animation in animations.EnumerateArray())
        {
            if (!animation.TryGetProperty("samplers", out var samplers) || samplers.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var sampler in samplers.EnumerateArray())
            {
                if (!sampler.TryGetProperty("input", out var inputProperty) || !inputProperty.TryGetInt32(out var inputIndex) ||
                    inputIndex < 0 || inputIndex >= accessors.GetArrayLength())
                {
                    continue;
                }

                var accessor = accessors[inputIndex];
                var candidate = ParseTimeAccessor(accessor);
                if (candidate is not null)
                {
                    candidates.Add(candidate);
                }
            }
        }

        return SelectBestTimeline(candidates);
    }

    private static ClipTimelineMetadata? ParseTimeAccessor(JsonElement accessor)
    {
        if (!accessor.TryGetProperty("count", out var countProperty) || !countProperty.TryGetInt32(out var frameCount) ||
            frameCount < 2 ||
            !TryReadFirstNumber(accessor, "min", out var startSeconds) ||
            !TryReadFirstNumber(accessor, "max", out var endSeconds))
        {
            return null;
        }

        var durationSeconds = endSeconds - startSeconds;
        if (durationSeconds <= 0)
        {
            return null;
        }

        return new ClipTimelineMetadata(
            frameCount,
            (frameCount - 1) / durationSeconds,
            durationSeconds);
    }

    private static ClipTimelineMetadata? SelectBestTimeline(IReadOnlyCollection<ClipTimelineMetadata> candidates)
    {
        if (candidates.Count == 0)
        {
            return null;
        }

        var maxDuration = candidates.Max(candidate => candidate.DurationSeconds);
        return candidates
            .Where(candidate => Math.Abs(candidate.DurationSeconds - maxDuration) <= DurationEpsilon)
            .GroupBy(candidate => candidate.FrameCount)
            .OrderByDescending(group => group.Count())
            .ThenBy(group => group.Key)
            .Select(group => group.First())
            .FirstOrDefault();
    }

    private static bool TryReadFirstNumber(JsonElement element, string propertyName, out double value)
    {
        value = 0;
        if (!element.TryGetProperty(propertyName, out var array) || array.ValueKind != JsonValueKind.Array ||
            array.GetArrayLength() == 0)
        {
            return false;
        }

        return array[0].TryGetDouble(out value);
    }
}
