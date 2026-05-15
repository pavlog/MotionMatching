using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace MotionMatching.Importers;

public sealed record RootMotionDiagnostics(
    string SourceName,
    int KeyCount,
    double DurationSeconds,
    double DisplacementX,
    double DisplacementY,
    double DisplacementZ,
    double HorizontalDistance,
    double AverageHorizontalSpeed);

public static class GltfRootMotionDiagnosticsParser
{
    private const uint GlbMagic = 0x46546C67;
    private const uint JsonChunkType = 0x4E4F534A;
    private const uint BinChunkType = 0x004E4942;
    private const int FloatComponentType = 5126;

    public static RootMotionDiagnostics? ParseGlb(string glbPath)
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
        var binaryOffset = 20 + jsonLength;
        if (bytes.Length < binaryOffset + 8)
        {
            return null;
        }

        var binaryLength = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(binaryOffset, 4)));
        var binaryType = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(binaryOffset + 4, 4));
        if (binaryType != BinChunkType || bytes.Length < binaryOffset + 8 + binaryLength)
        {
            return null;
        }

        var binary = bytes.AsSpan(binaryOffset + 8, binaryLength).ToArray();
        return ParseGltfJson(jsonText, binary);
    }

    public static RootMotionDiagnostics? ParseGltfJson(string jsonText, byte[] binary)
    {
        using var document = JsonDocument.Parse(jsonText);
        var root = document.RootElement;
        if (!root.TryGetProperty("animations", out var animations) || animations.ValueKind != JsonValueKind.Array ||
            !root.TryGetProperty("accessors", out var accessors) || accessors.ValueKind != JsonValueKind.Array ||
            !root.TryGetProperty("bufferViews", out var bufferViews) || bufferViews.ValueKind != JsonValueKind.Array ||
            !root.TryGetProperty("nodes", out var nodes) || nodes.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        RootMotionCandidate? best = null;
        foreach (var animation in animations.EnumerateArray())
        {
            if (!animation.TryGetProperty("samplers", out var samplers) || samplers.ValueKind != JsonValueKind.Array ||
                !animation.TryGetProperty("channels", out var channels) || channels.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var channel in channels.EnumerateArray())
            {
                var candidate = TryReadCandidate(channel, samplers, accessors, bufferViews, nodes, binary);
                if (candidate is null)
                {
                    continue;
                }

                if (best is null || candidate.Priority < best.Priority ||
                    candidate.Priority == best.Priority && candidate.Diagnostics.HorizontalDistance > best.Diagnostics.HorizontalDistance)
                {
                    best = candidate;
                }
            }
        }

        return best?.Diagnostics;
    }

    private static RootMotionCandidate? TryReadCandidate(
        JsonElement channel,
        JsonElement samplers,
        JsonElement accessors,
        JsonElement bufferViews,
        JsonElement nodes,
        byte[] binary)
    {
        if (!channel.TryGetProperty("target", out var target) ||
            !target.TryGetProperty("path", out var pathProperty) ||
            !string.Equals(pathProperty.GetString(), "translation", StringComparison.Ordinal) ||
            !target.TryGetProperty("node", out var nodeProperty) ||
            !nodeProperty.TryGetInt32(out var nodeIndex) ||
            nodeIndex < 0 || nodeIndex >= nodes.GetArrayLength() ||
            !channel.TryGetProperty("sampler", out var samplerProperty) ||
            !samplerProperty.TryGetInt32(out var samplerIndex) ||
            samplerIndex < 0 || samplerIndex >= samplers.GetArrayLength())
        {
            return null;
        }

        var node = nodes[nodeIndex];
        var sourceName = node.TryGetProperty("name", out var nameProperty)
            ? nameProperty.GetString() ?? $"node_{nodeIndex}"
            : $"node_{nodeIndex}";
        var normalizedName = NormalizeSourceName(sourceName);
        var priority = GetRootMotionPriority(normalizedName);
        if (priority > 1)
        {
            return null;
        }

        var sampler = samplers[samplerIndex];
        if (!sampler.TryGetProperty("input", out var inputProperty) ||
            !inputProperty.TryGetInt32(out var inputIndex) ||
            inputIndex < 0 || inputIndex >= accessors.GetArrayLength() ||
            !sampler.TryGetProperty("output", out var outputProperty) ||
            !outputProperty.TryGetInt32(out var outputIndex) ||
            outputIndex < 0 || outputIndex >= accessors.GetArrayLength())
        {
            return null;
        }

        var durationSeconds = TryReadDuration(accessors[inputIndex]);
        if (durationSeconds <= 0)
        {
            return null;
        }

        var values = TryReadVector3Accessor(accessors[outputIndex], bufferViews, binary);
        if (values.Count < 2)
        {
            return null;
        }

        var first = values[0];
        var last = values[^1];
        var dx = last.X - first.X;
        var dy = last.Y - first.Y;
        var dz = last.Z - first.Z;
        var horizontalDistance = Math.Sqrt(dx * dx + dz * dz);

        return new RootMotionCandidate(
            priority,
            new RootMotionDiagnostics(
                sourceName,
                values.Count,
                durationSeconds,
                dx,
                dy,
                dz,
                horizontalDistance,
                horizontalDistance / durationSeconds));
    }

    private static double TryReadDuration(JsonElement accessor)
    {
        if (!TryReadFirstNumber(accessor, "min", out var min) || !TryReadFirstNumber(accessor, "max", out var max))
        {
            return 0;
        }

        return max - min;
    }

    private static List<Vector3Value> TryReadVector3Accessor(JsonElement accessor, JsonElement bufferViews, byte[] binary)
    {
        if (!accessor.TryGetProperty("bufferView", out var bufferViewProperty) ||
            !bufferViewProperty.TryGetInt32(out var bufferViewIndex) ||
            bufferViewIndex < 0 || bufferViewIndex >= bufferViews.GetArrayLength() ||
            !accessor.TryGetProperty("componentType", out var componentTypeProperty) ||
            !componentTypeProperty.TryGetInt32(out var componentType) ||
            componentType != FloatComponentType ||
            !accessor.TryGetProperty("type", out var typeProperty) ||
            !string.Equals(typeProperty.GetString(), "VEC3", StringComparison.Ordinal) ||
            !accessor.TryGetProperty("count", out var countProperty) ||
            !countProperty.TryGetInt32(out var count) ||
            count < 1)
        {
            return [];
        }

        var bufferView = bufferViews[bufferViewIndex];
        var byteOffset = GetOptionalInt(bufferView, "byteOffset") + GetOptionalInt(accessor, "byteOffset");
        var byteStride = GetOptionalInt(bufferView, "byteStride");
        if (byteStride <= 0)
        {
            byteStride = sizeof(float) * 3;
        }

        var values = new List<Vector3Value>(count);
        for (var index = 0; index < count; index++)
        {
            var offset = byteOffset + index * byteStride;
            if (offset < 0 || offset + sizeof(float) * 3 > binary.Length)
            {
                return [];
            }

            values.Add(new Vector3Value(
                BinaryPrimitives.ReadSingleLittleEndian(binary.AsSpan(offset, sizeof(float))),
                BinaryPrimitives.ReadSingleLittleEndian(binary.AsSpan(offset + sizeof(float), sizeof(float))),
                BinaryPrimitives.ReadSingleLittleEndian(binary.AsSpan(offset + sizeof(float) * 2, sizeof(float)))));
        }

        return values;
    }

    private static int GetOptionalInt(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) && property.TryGetInt32(out var value)
            ? value
            : 0;
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

    private static int GetRootMotionPriority(string normalizedName)
    {
        if (normalizedName is "root" or "skeleton")
        {
            return 0;
        }

        if (normalizedName is "hips" or "pelvis")
        {
            return 1;
        }

        return 2;
    }

    private static string NormalizeSourceName(string sourceName)
    {
        var normalized = sourceName.Trim().ToLowerInvariant();
        foreach (var prefix in new[] { "mixamorig:", "mixamorig_", "armature|", "armature/" })
        {
            if (normalized.StartsWith(prefix, StringComparison.Ordinal))
            {
                normalized = normalized[prefix.Length..];
            }
        }

        return normalized.Replace(" ", string.Empty, StringComparison.Ordinal);
    }

    private sealed record RootMotionCandidate(int Priority, RootMotionDiagnostics Diagnostics);

    private readonly record struct Vector3Value(double X, double Y, double Z);
}
