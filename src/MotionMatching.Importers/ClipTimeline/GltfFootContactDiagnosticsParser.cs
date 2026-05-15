using System.Buffers.Binary;
using System.Numerics;
using System.Text;
using System.Text.Json;

namespace MotionMatching.Importers;

public sealed record FootContactDiagnostics(
    double VelocityThreshold,
    IReadOnlyList<FootContactTrack> Tracks);

public sealed record FootContactTrack(
    string Foot,
    string SourceName,
    int KeyCount,
    IReadOnlyList<FootContactRange> Ranges);

public sealed record FootContactRange(
    int StartFrame,
    int EndFrame,
    double StartSeconds,
    double EndSeconds);

public static class GltfFootContactDiagnosticsParser
{
    private const uint GlbMagic = 0x46546C67;
    private const uint JsonChunkType = 0x4E4F534A;
    private const uint BinChunkType = 0x004E4942;
    private const int FloatComponentType = 5126;
    private const double DefaultVelocityThreshold = 15;

    public static FootContactDiagnostics? ParseGlb(string glbPath, double velocityThreshold = DefaultVelocityThreshold)
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
        return ParseGltfJson(jsonText, binary, velocityThreshold);
    }

    public static FootContactDiagnostics? ParseGltfJson(
        string jsonText,
        byte[] binary,
        double velocityThreshold = DefaultVelocityThreshold)
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

        var nodeInfos = ReadNodes(nodes);
        var candidates = new List<FootContactTrack>();
        foreach (var animation in animations.EnumerateArray())
        {
            if (!animation.TryGetProperty("samplers", out var samplers) || samplers.ValueKind != JsonValueKind.Array ||
                !animation.TryGetProperty("channels", out var channels) || channels.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            var animationData = ReadAnimationData(channels, samplers, accessors, bufferViews, nodes, binary);
            foreach (var footNodeIndex in Enumerable.Range(0, nodeInfos.Length).Where(index => TryGetFoot(nodeInfos[index].Name) is not null))
            {
                var track = TryBuildWorldSpaceTrack(footNodeIndex, nodeInfos, animationData, velocityThreshold);
                if (track is not null)
                {
                    candidates.Add(track);
                }
            }
        }

        var selected = candidates
            .GroupBy(track => track.Foot, StringComparer.Ordinal)
            .Select(group => group
                .OrderByDescending(track => track.Ranges.Sum(range => range.EndFrame - range.StartFrame + 1))
                .ThenByDescending(track => track.KeyCount)
                .First())
            .OrderBy(track => track.Foot, StringComparer.Ordinal)
            .ToArray();

        return selected.Length == 0
            ? null
            : new FootContactDiagnostics(velocityThreshold, selected);
    }

    private static FootContactTrack? TryBuildWorldSpaceTrack(
        int footNodeIndex,
        IReadOnlyList<NodeInfo> nodes,
        AnimationData animationData,
        double velocityThreshold)
    {
        var sourceName = nodes[footNodeIndex].Name;
        var foot = TryGetFoot(sourceName);
        if (foot is null)
        {
            return null;
        }

        var times = SelectTimeline(animationData, GetNodeChain(footNodeIndex, nodes));
        if (times.Count < 2)
        {
            return null;
        }

        var positions = new List<Vector3Value>(times.Count);
        foreach (var time in times)
        {
            var world = CalculateWorldMatrix(footNodeIndex, nodes, animationData, time);
            positions.Add(new Vector3Value(world.M41, world.M42, world.M43));
        }

        var ranges = DetectContactRanges(times, positions, velocityThreshold);
        if (ranges.Count == 0)
        {
            ranges = DetectContactRanges(times, positions, EstimateFallbackThreshold(times, positions, velocityThreshold));
        }

        ranges = ranges
            .Where(range => !CoversAlmostWholeClip(range, times.Count))
            .ToArray();

        return ranges.Count == 0
            ? null
            : new FootContactTrack(foot, sourceName, times.Count, ranges);
    }

    private static AnimationData ReadAnimationData(
        JsonElement channels,
        JsonElement samplers,
        JsonElement accessors,
        JsonElement bufferViews,
        JsonElement nodes,
        byte[] binary)
    {
        var data = new AnimationData();
        foreach (var channel in channels.EnumerateArray())
        {
            if (!channel.TryGetProperty("target", out var target) ||
                !target.TryGetProperty("path", out var pathProperty) ||
                !target.TryGetProperty("node", out var nodeProperty) ||
                !nodeProperty.TryGetInt32(out var nodeIndex) ||
                nodeIndex < 0 || nodeIndex >= nodes.GetArrayLength() ||
                !channel.TryGetProperty("sampler", out var samplerProperty) ||
                !samplerProperty.TryGetInt32(out var samplerIndex) ||
                samplerIndex < 0 || samplerIndex >= samplers.GetArrayLength())
            {
                continue;
            }

            var path = pathProperty.GetString();
            var sampler = samplers[samplerIndex];
            if (!sampler.TryGetProperty("input", out var inputProperty) ||
                !inputProperty.TryGetInt32(out var inputIndex) ||
                inputIndex < 0 || inputIndex >= accessors.GetArrayLength() ||
                !sampler.TryGetProperty("output", out var outputProperty) ||
                !outputProperty.TryGetInt32(out var outputIndex) ||
                outputIndex < 0 || outputIndex >= accessors.GetArrayLength())
            {
                continue;
            }

            var times = TryReadFloatAccessor(accessors[inputIndex], bufferViews, binary);
            if (times.Count < 2)
            {
                continue;
            }

            if (string.Equals(path, "translation", StringComparison.Ordinal))
            {
                var values = TryReadVector3Accessor(accessors[outputIndex], bufferViews, binary);
                if (values.Count == times.Count)
                {
                    data.Translations[nodeIndex] = new Vector3Track(times, values);
                }
            }
            else if (string.Equals(path, "rotation", StringComparison.Ordinal))
            {
                var values = TryReadQuaternionAccessor(accessors[outputIndex], bufferViews, binary);
                if (values.Count == times.Count)
                {
                    data.Rotations[nodeIndex] = new QuaternionTrack(times, values);
                }
            }
            else if (string.Equals(path, "scale", StringComparison.Ordinal))
            {
                var values = TryReadVector3Accessor(accessors[outputIndex], bufferViews, binary);
                if (values.Count == times.Count)
                {
                    data.Scales[nodeIndex] = new Vector3Track(times, values);
                }
            }
        }

        return data;
    }

    private static NodeInfo[] ReadNodes(JsonElement nodes)
    {
        var infos = new NodeInfo[nodes.GetArrayLength()];
        for (var index = 0; index < infos.Length; index++)
        {
            var node = nodes[index];
            var name = node.TryGetProperty("name", out var nameProperty)
                ? nameProperty.GetString() ?? $"node_{index}"
                : $"node_{index}";
            infos[index] = new NodeInfo(
                name,
                -1,
                TryReadVector3Property(node, "translation", new Vector3Value(0, 0, 0)),
                TryReadQuaternionProperty(node, "rotation"),
                TryReadVector3Property(node, "scale", new Vector3Value(1, 1, 1)));
        }

        for (var index = 0; index < infos.Length; index++)
        {
            var node = nodes[index];
            if (!node.TryGetProperty("children", out var children) || children.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var child in children.EnumerateArray())
            {
                if (child.TryGetInt32(out var childIndex) && childIndex >= 0 && childIndex < infos.Length)
                {
                    infos[childIndex] = infos[childIndex] with { ParentIndex = index };
                }
            }
        }

        return infos;
    }

    private static IReadOnlyList<int> GetNodeChain(int nodeIndex, IReadOnlyList<NodeInfo> nodes)
    {
        var chain = new List<int>();
        var current = nodeIndex;
        while (current >= 0 && current < nodes.Count)
        {
            chain.Add(current);
            current = nodes[current].ParentIndex;
        }

        return chain;
    }

    private static IReadOnlyList<double> SelectTimeline(AnimationData animationData, IReadOnlyList<int> nodeChain)
    {
        return nodeChain
            .SelectMany(nodeIndex => new[]
            {
                animationData.Translations.TryGetValue(nodeIndex, out var translation) ? translation.Times : null,
                animationData.Rotations.TryGetValue(nodeIndex, out var rotation) ? rotation.Times : null,
                animationData.Scales.TryGetValue(nodeIndex, out var scale) ? scale.Times : null
            })
            .Where(times => times is not null)
            .Select(times => times!)
            .OrderByDescending(times => times.Count)
            .ThenByDescending(times => times[^1] - times[0])
            .FirstOrDefault() ?? [];
    }

    private static Matrix4x4 CalculateWorldMatrix(
        int nodeIndex,
        IReadOnlyList<NodeInfo> nodes,
        AnimationData animationData,
        double time)
    {
        var local = CalculateLocalMatrix(nodeIndex, nodes[nodeIndex], animationData, time);
        var parentIndex = nodes[nodeIndex].ParentIndex;
        if (parentIndex < 0)
        {
            return local;
        }

        return local * CalculateWorldMatrix(parentIndex, nodes, animationData, time);
    }

    private static Matrix4x4 CalculateLocalMatrix(
        int nodeIndex,
        NodeInfo node,
        AnimationData animationData,
        double time)
    {
        var translation = animationData.Translations.TryGetValue(nodeIndex, out var translationTrack)
            ? SampleVector3(translationTrack, time)
            : node.Translation;
        var rotation = animationData.Rotations.TryGetValue(nodeIndex, out var rotationTrack)
            ? SampleQuaternion(rotationTrack, time)
            : node.Rotation;
        var scale = animationData.Scales.TryGetValue(nodeIndex, out var scaleTrack)
            ? SampleVector3(scaleTrack, time)
            : node.Scale;

        return Matrix4x4.CreateScale((float)scale.X, (float)scale.Y, (float)scale.Z) *
            Matrix4x4.CreateFromQuaternion(rotation) *
            Matrix4x4.CreateTranslation((float)translation.X, (float)translation.Y, (float)translation.Z);
    }

    private static bool CoversAlmostWholeClip(FootContactRange range, int frameCount)
    {
        if (frameCount <= 1)
        {
            return true;
        }

        var coveredFrames = range.EndFrame - range.StartFrame + 1;
        return range.StartFrame == 0 && range.EndFrame >= frameCount - 1 && coveredFrames / (double)frameCount >= 0.9;
    }

    private static double EstimateFallbackThreshold(
        IReadOnlyList<double> times,
        IReadOnlyList<Vector3Value> positions,
        double minimumThreshold)
    {
        var speeds = new List<double>();
        for (var index = 1; index < times.Count; index++)
        {
            var dt = times[index] - times[index - 1];
            if (dt <= 0)
            {
                continue;
            }

            var dx = positions[index].X - positions[index - 1].X;
            var dy = positions[index].Y - positions[index - 1].Y;
            var dz = positions[index].Z - positions[index - 1].Z;
            speeds.Add(Math.Sqrt(dx * dx + dy * dy + dz * dz) / dt);
        }

        if (speeds.Count == 0)
        {
            return minimumThreshold;
        }

        speeds.Sort();
        var lowQuartileIndex = Math.Clamp((int)Math.Floor((speeds.Count - 1) * 0.25), 0, speeds.Count - 1);
        return Math.Max(minimumThreshold, speeds[lowQuartileIndex] * 1.05);
    }

    private static IReadOnlyList<FootContactRange> DetectContactRanges(
        IReadOnlyList<double> times,
        IReadOnlyList<Vector3Value> positions,
        double velocityThreshold)
    {
        var contactFrames = new bool[times.Count];
        for (var index = 1; index < times.Count; index++)
        {
            var dt = times[index] - times[index - 1];
            if (dt <= 0)
            {
                continue;
            }

            var dx = positions[index].X - positions[index - 1].X;
            var dy = positions[index].Y - positions[index - 1].Y;
            var dz = positions[index].Z - positions[index - 1].Z;
            var speed = Math.Sqrt(dx * dx + dy * dy + dz * dz) / dt;
            if (speed <= velocityThreshold)
            {
                contactFrames[index - 1] = true;
                contactFrames[index] = true;
            }
        }

        var ranges = new List<FootContactRange>();
        var start = -1;
        for (var index = 0; index < contactFrames.Length; index++)
        {
            if (contactFrames[index] && start < 0)
            {
                start = index;
            }

            var isRangeEnd = start >= 0 && (!contactFrames[index] || index == contactFrames.Length - 1);
            if (!isRangeEnd)
            {
                continue;
            }

            var end = contactFrames[index] ? index : index - 1;
            if (end - start >= 1)
            {
                ranges.Add(new FootContactRange(start, end, times[start], times[end]));
            }

            start = -1;
        }

        return ranges;
    }

    private static List<double> TryReadFloatAccessor(JsonElement accessor, JsonElement bufferViews, byte[] binary)
    {
        if (!TryGetAccessorReadInfo(accessor, bufferViews, "SCALAR", out var byteOffset, out var byteStride, out var count))
        {
            return [];
        }

        if (byteStride <= 0)
        {
            byteStride = sizeof(float);
        }

        var values = new List<double>(count);
        for (var index = 0; index < count; index++)
        {
            var offset = byteOffset + index * byteStride;
            if (offset < 0 || offset + sizeof(float) > binary.Length)
            {
                return [];
            }

            values.Add(BinaryPrimitives.ReadSingleLittleEndian(binary.AsSpan(offset, sizeof(float))));
        }

        return values;
    }

    private static List<Vector3Value> TryReadVector3Accessor(JsonElement accessor, JsonElement bufferViews, byte[] binary)
    {
        if (!TryGetAccessorReadInfo(accessor, bufferViews, "VEC3", out var byteOffset, out var byteStride, out var count))
        {
            return [];
        }

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

    private static List<Quaternion> TryReadQuaternionAccessor(JsonElement accessor, JsonElement bufferViews, byte[] binary)
    {
        if (!TryGetAccessorReadInfo(accessor, bufferViews, "VEC4", out var byteOffset, out var byteStride, out var count))
        {
            return [];
        }

        if (byteStride <= 0)
        {
            byteStride = sizeof(float) * 4;
        }

        var values = new List<Quaternion>(count);
        for (var index = 0; index < count; index++)
        {
            var offset = byteOffset + index * byteStride;
            if (offset < 0 || offset + sizeof(float) * 4 > binary.Length)
            {
                return [];
            }

            values.Add(Quaternion.Normalize(new Quaternion(
                BinaryPrimitives.ReadSingleLittleEndian(binary.AsSpan(offset, sizeof(float))),
                BinaryPrimitives.ReadSingleLittleEndian(binary.AsSpan(offset + sizeof(float), sizeof(float))),
                BinaryPrimitives.ReadSingleLittleEndian(binary.AsSpan(offset + sizeof(float) * 2, sizeof(float))),
                BinaryPrimitives.ReadSingleLittleEndian(binary.AsSpan(offset + sizeof(float) * 3, sizeof(float))))));
        }

        return values;
    }

    private static bool TryGetAccessorReadInfo(
        JsonElement accessor,
        JsonElement bufferViews,
        string expectedType,
        out int byteOffset,
        out int byteStride,
        out int count)
    {
        byteOffset = 0;
        byteStride = 0;
        count = 0;
        if (!accessor.TryGetProperty("bufferView", out var bufferViewProperty) ||
            !bufferViewProperty.TryGetInt32(out var bufferViewIndex) ||
            bufferViewIndex < 0 || bufferViewIndex >= bufferViews.GetArrayLength() ||
            !accessor.TryGetProperty("componentType", out var componentTypeProperty) ||
            !componentTypeProperty.TryGetInt32(out var componentType) ||
            componentType != FloatComponentType ||
            !accessor.TryGetProperty("type", out var typeProperty) ||
            !string.Equals(typeProperty.GetString(), expectedType, StringComparison.Ordinal) ||
            !accessor.TryGetProperty("count", out var countProperty) ||
            !countProperty.TryGetInt32(out count) ||
            count < 1)
        {
            return false;
        }

        var bufferView = bufferViews[bufferViewIndex];
        byteOffset = GetOptionalInt(bufferView, "byteOffset") + GetOptionalInt(accessor, "byteOffset");
        byteStride = GetOptionalInt(bufferView, "byteStride");
        return true;
    }

    private static int GetOptionalInt(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) && property.TryGetInt32(out var value)
            ? value
            : 0;
    }

    private static Vector3Value TryReadVector3Property(JsonElement element, string propertyName, Vector3Value fallback)
    {
        if (!element.TryGetProperty(propertyName, out var array) ||
            array.ValueKind != JsonValueKind.Array ||
            array.GetArrayLength() < 3)
        {
            return fallback;
        }

        return new Vector3Value(
            array[0].TryGetDouble(out var x) ? x : fallback.X,
            array[1].TryGetDouble(out var y) ? y : fallback.Y,
            array[2].TryGetDouble(out var z) ? z : fallback.Z);
    }

    private static Quaternion TryReadQuaternionProperty(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var array) ||
            array.ValueKind != JsonValueKind.Array ||
            array.GetArrayLength() < 4)
        {
            return Quaternion.Identity;
        }

        return Quaternion.Normalize(new Quaternion(
            array[0].TryGetSingle(out var x) ? x : 0,
            array[1].TryGetSingle(out var y) ? y : 0,
            array[2].TryGetSingle(out var z) ? z : 0,
            array[3].TryGetSingle(out var w) ? w : 1));
    }

    private static Vector3Value SampleVector3(Vector3Track track, double time)
    {
        var index = FindSampleIndex(track.Times, time);
        if (index >= track.Times.Count - 1)
        {
            return track.Values[^1];
        }

        var startTime = track.Times[index];
        var endTime = track.Times[index + 1];
        if (endTime <= startTime)
        {
            return track.Values[index];
        }

        var t = (time - startTime) / (endTime - startTime);
        var start = track.Values[index];
        var end = track.Values[index + 1];
        return new Vector3Value(
            start.X + (end.X - start.X) * t,
            start.Y + (end.Y - start.Y) * t,
            start.Z + (end.Z - start.Z) * t);
    }

    private static Quaternion SampleQuaternion(QuaternionTrack track, double time)
    {
        var index = FindSampleIndex(track.Times, time);
        if (index >= track.Times.Count - 1)
        {
            return track.Values[^1];
        }

        var startTime = track.Times[index];
        var endTime = track.Times[index + 1];
        if (endTime <= startTime)
        {
            return track.Values[index];
        }

        var t = (float)((time - startTime) / (endTime - startTime));
        return Quaternion.Normalize(Quaternion.Slerp(track.Values[index], track.Values[index + 1], t));
    }

    private static int FindSampleIndex(IReadOnlyList<double> times, double time)
    {
        if (times.Count < 2 || time <= times[0])
        {
            return 0;
        }

        for (var index = 0; index < times.Count - 1; index++)
        {
            if (time >= times[index] && time <= times[index + 1])
            {
                return index;
            }
        }

        return times.Count - 1;
    }

    private static string? TryGetFoot(string sourceName)
    {
        var normalized = NormalizeSourceName(sourceName);
        if (normalized.Contains("lefttoe", StringComparison.Ordinal) ||
            normalized.Contains("ltoe", StringComparison.Ordinal) ||
            normalized.Contains("leftfoot", StringComparison.Ordinal) ||
            normalized.Contains("lfoot", StringComparison.Ordinal))
        {
            return "left";
        }

        if (normalized.Contains("righttoe", StringComparison.Ordinal) ||
            normalized.Contains("rtoe", StringComparison.Ordinal) ||
            normalized.Contains("rightfoot", StringComparison.Ordinal) ||
            normalized.Contains("rfoot", StringComparison.Ordinal))
        {
            return "right";
        }

        return null;
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

        return normalized
            .Replace(" ", string.Empty, StringComparison.Ordinal)
            .Replace("_", string.Empty, StringComparison.Ordinal)
            .Replace("-", string.Empty, StringComparison.Ordinal)
            .Replace(".", string.Empty, StringComparison.Ordinal);
    }

    private sealed class AnimationData
    {
        public Dictionary<int, Vector3Track> Translations { get; } = [];

        public Dictionary<int, QuaternionTrack> Rotations { get; } = [];

        public Dictionary<int, Vector3Track> Scales { get; } = [];
    }

    private sealed record Vector3Track(IReadOnlyList<double> Times, IReadOnlyList<Vector3Value> Values);

    private sealed record QuaternionTrack(IReadOnlyList<double> Times, IReadOnlyList<Quaternion> Values);

    private sealed record NodeInfo(
        string Name,
        int ParentIndex,
        Vector3Value Translation,
        Quaternion Rotation,
        Vector3Value Scale);

    private readonly record struct Vector3Value(double X, double Y, double Z);
}
