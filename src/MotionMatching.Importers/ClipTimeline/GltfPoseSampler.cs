using System.Buffers.Binary;
using System.Numerics;
using System.Text;
using System.Text.Json;

namespace MotionMatching.Importers;

public sealed record GltfPoseSample(
    int Frame,
    double Seconds,
    IReadOnlyList<GltfPoseBoneSample> Bones);

public sealed record GltfPoseBoneSample(
    string BoneName,
    double[] Translation,
    double[] Rotation,
    double[] Scale);

public static class GltfPoseSampler
{
    private const uint GlbMagic = 0x46546C67;
    private const uint JsonChunkType = 0x4E4F534A;
    private const uint BinChunkType = 0x004E4942;
    private const int FloatComponentType = 5126;

    public static IReadOnlyList<GltfPoseSample> ParseGlb(
        string glbPath,
        IReadOnlyList<int> sampleFrames,
        double? frameRate,
        double? durationSeconds,
        IReadOnlyList<string> boneNames)
    {
        var bytes = File.ReadAllBytes(glbPath);
        if (bytes.Length < 20 || BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(0, 4)) != GlbMagic)
        {
            return [];
        }

        var jsonLength = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(12, 4)));
        var jsonType = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(16, 4));
        if (jsonType != JsonChunkType || bytes.Length < 20 + jsonLength)
        {
            return [];
        }

        var jsonText = Encoding.UTF8.GetString(bytes, 20, jsonLength).TrimEnd('\0', ' ', '\n', '\r', '\t');
        var binaryOffset = 20 + jsonLength;
        if (bytes.Length < binaryOffset + 8)
        {
            return [];
        }

        var binaryLength = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(binaryOffset, 4)));
        var binaryType = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(binaryOffset + 4, 4));
        if (binaryType != BinChunkType || bytes.Length < binaryOffset + 8 + binaryLength)
        {
            return [];
        }

        var binary = bytes.AsSpan(binaryOffset + 8, binaryLength).ToArray();
        return ParseGltfJson(jsonText, binary, sampleFrames, frameRate, durationSeconds, boneNames);
    }

    public static IReadOnlyList<GltfPoseSample> ParseGltfJson(
        string jsonText,
        byte[] binary,
        IReadOnlyList<int> sampleFrames,
        double? frameRate,
        double? durationSeconds,
        IReadOnlyList<string> boneNames)
    {
        using var document = JsonDocument.Parse(jsonText);
        var root = document.RootElement;
        if (!root.TryGetProperty("nodes", out var nodes) || nodes.ValueKind != JsonValueKind.Array ||
            !root.TryGetProperty("animations", out var animations) || animations.ValueKind != JsonValueKind.Array ||
            !root.TryGetProperty("accessors", out var accessors) || accessors.ValueKind != JsonValueKind.Array ||
            !root.TryGetProperty("bufferViews", out var bufferViews) || bufferViews.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var nodeInfos = ReadNodes(nodes);
        var animationData = ReadAnimationData(animations, accessors, bufferViews, nodes, binary);
        var requestedNames = new HashSet<string>(boneNames.Select(NormalizeName), StringComparer.Ordinal);
        var sampleNodes = nodeInfos
            .Select((node, index) => new { Node = node, Index = index, NormalizedName = NormalizeName(node.Name) })
            .Where(item => requestedNames.Count == 0 || requestedNames.Contains(item.NormalizedName))
            .ToArray();

        if (sampleNodes.Length == 0)
        {
            return [];
        }

        return sampleFrames
            .Select(frame =>
            {
                var seconds = ToSeconds(frame, frameRate, durationSeconds);
                var bones = sampleNodes
                    .Select(item =>
                    {
                        var transform = SampleLocalTransform(item.Index, item.Node, animationData, seconds);
                        return new GltfPoseBoneSample(
                            item.Node.Name,
                            [Round(transform.Translation.X), Round(transform.Translation.Y), Round(transform.Translation.Z)],
                            [Round(transform.Rotation.X), Round(transform.Rotation.Y), Round(transform.Rotation.Z), Round(transform.Rotation.W)],
                            [Round(transform.Scale.X), Round(transform.Scale.Y), Round(transform.Scale.Z)]);
                    })
                    .ToArray();

                return new GltfPoseSample(frame, Round(seconds), bones);
            })
            .ToArray();
    }

    private static AnimationData ReadAnimationData(
        JsonElement animations,
        JsonElement accessors,
        JsonElement bufferViews,
        JsonElement nodes,
        byte[] binary)
    {
        var data = new AnimationData();
        foreach (var animation in animations.EnumerateArray())
        {
            if (!animation.TryGetProperty("samplers", out var samplers) || samplers.ValueKind != JsonValueKind.Array ||
                !animation.TryGetProperty("channels", out var channels) || channels.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

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

                var path = pathProperty.GetString();
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
                TryReadVector3Property(node, "translation", new Vector3(0, 0, 0)),
                TryReadQuaternionProperty(node, "rotation"),
                TryReadVector3Property(node, "scale", new Vector3(1, 1, 1)));
        }

        return infos;
    }

    private static LocalTransform SampleLocalTransform(int nodeIndex, NodeInfo node, AnimationData animationData, double time)
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

        return new LocalTransform(translation, rotation, scale);
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

    private static List<Vector3> TryReadVector3Accessor(JsonElement accessor, JsonElement bufferViews, byte[] binary)
    {
        if (!TryGetAccessorReadInfo(accessor, bufferViews, "VEC3", out var byteOffset, out var byteStride, out var count))
        {
            return [];
        }

        if (byteStride <= 0)
        {
            byteStride = sizeof(float) * 3;
        }

        var values = new List<Vector3>(count);
        for (var index = 0; index < count; index++)
        {
            var offset = byteOffset + index * byteStride;
            if (offset < 0 || offset + sizeof(float) * 3 > binary.Length)
            {
                return [];
            }

            values.Add(new Vector3(
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

    private static Vector3 TryReadVector3Property(JsonElement element, string propertyName, Vector3 fallback)
    {
        if (!element.TryGetProperty(propertyName, out var array) ||
            array.ValueKind != JsonValueKind.Array ||
            array.GetArrayLength() < 3)
        {
            return fallback;
        }

        return new Vector3(
            array[0].TryGetSingle(out var x) ? x : fallback.X,
            array[1].TryGetSingle(out var y) ? y : fallback.Y,
            array[2].TryGetSingle(out var z) ? z : fallback.Z);
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

    private static Vector3 SampleVector3(Vector3Track track, double time)
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
        return Vector3.Lerp(track.Values[index], track.Values[index + 1], t);
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

    private static int GetOptionalInt(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) && property.TryGetInt32(out var value)
            ? value
            : 0;
    }

    private static double ToSeconds(int frame, double? frameRate, double? durationSeconds)
    {
        if (frameRate is > 0)
        {
            return frame / frameRate.Value;
        }

        return durationSeconds is > 0 ? Math.Min(durationSeconds.Value, frame / 30.0) : frame / 30.0;
    }

    private static string NormalizeName(string name)
    {
        var normalized = name.Trim().ToLowerInvariant();
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

    private static double Round(double value)
    {
        return Math.Round(value, 6);
    }

    private sealed class AnimationData
    {
        public Dictionary<int, Vector3Track> Translations { get; } = [];

        public Dictionary<int, QuaternionTrack> Rotations { get; } = [];

        public Dictionary<int, Vector3Track> Scales { get; } = [];
    }

    private sealed record Vector3Track(IReadOnlyList<double> Times, IReadOnlyList<Vector3> Values);

    private sealed record QuaternionTrack(IReadOnlyList<double> Times, IReadOnlyList<Quaternion> Values);

    private sealed record NodeInfo(string Name, Vector3 Translation, Quaternion Rotation, Vector3 Scale);

    private readonly record struct LocalTransform(Vector3 Translation, Quaternion Rotation, Vector3 Scale);
}
