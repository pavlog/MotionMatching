using System.Text.Json.Serialization;

namespace MotionMatching.Authoring;

public sealed record ClipManifest
{
    [JsonPropertyName("$schema")]
    public string Schema { get; init; } = "docs/schemas/motionclip.schema.json";

    public int SchemaVersion { get; init; } = 1;

    public required StudioId Id { get; init; }

    public required string Name { get; init; }

    public required ClipSourceKind SourceKind { get; init; }

    public required string SourceFileName { get; init; }

    public required string ManagedSourcePath { get; init; }

    public required long SourceFileSizeBytes { get; init; }

    public int? FrameCount { get; init; }

    public double? FrameRate { get; init; }

    public double? DurationSeconds { get; init; }

    public DateTimeOffset ImportedAtUtc { get; init; } = DateTimeOffset.UnixEpoch;

    public bool IncludeInBuild { get; init; } = true;

    public string? ClipRole { get; init; }

    public List<string> Tags { get; init; } = [];

    public static ClipManifest FromUploadedSource(
        StudioId id,
        string name,
        string uploadedFileNameOrPath,
        long sourceFileSizeBytes)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Clip name cannot be empty.", nameof(name));
        }

        if (sourceFileSizeBytes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(sourceFileSizeBytes), "Source file size cannot be negative.");
        }

        var fileName = GetFileName(uploadedFileNameOrPath);
        if (string.IsNullOrWhiteSpace(fileName))
        {
            throw new ArgumentException("Uploaded source must have a file name.", nameof(uploadedFileNameOrPath));
        }

        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        var sourceKind = extension switch
        {
            ".fbx" => ClipSourceKind.Fbx,
            ".bvh" => ClipSourceKind.Bvh,
            _ => throw new ArgumentException("Clip source must be an FBX or BVH file.", nameof(uploadedFileNameOrPath))
        };

        return new ClipManifest
        {
            Id = id,
            Name = name,
            SourceKind = sourceKind,
            SourceFileName = fileName,
            ManagedSourcePath = $"source{extension}",
            SourceFileSizeBytes = sourceFileSizeBytes
        };
    }

    private static string GetFileName(string value)
    {
        return Path.GetFileName(value.Replace('\\', Path.DirectorySeparatorChar));
    }
}

public enum ClipSourceKind
{
    Fbx,
    Bvh
}
