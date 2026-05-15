using System.Text.Json.Serialization;

namespace MotionMatching.Authoring;

public sealed record VisualManifest
{
    [JsonPropertyName("$schema")]
    public string Schema { get; init; } = "docs/schemas/motionvisual.schema.json";

    public int SchemaVersion { get; init; } = 1;

    public required StudioId Id { get; init; }

    public required string SourceFileName { get; init; }

    public string ManagedSourcePath { get; init; } = "Visual/source.fbx";

    public required long SourceFileSizeBytes { get; init; }

    public DateTimeOffset ImportedAtUtc { get; init; } = DateTimeOffset.UnixEpoch;

    public static VisualManifest FromUploadedSource(StudioId id, string uploadedFileNameOrPath, long sourceFileSizeBytes)
    {
        if (sourceFileSizeBytes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(sourceFileSizeBytes), "Source file size cannot be negative.");
        }

        var fileName = Path.GetFileName(uploadedFileNameOrPath);
        if (string.IsNullOrWhiteSpace(fileName))
        {
            throw new ArgumentException("Uploaded source must have a file name.", nameof(uploadedFileNameOrPath));
        }

        return new VisualManifest
        {
            Id = id,
            SourceFileName = fileName,
            SourceFileSizeBytes = sourceFileSizeBytes
        };
    }
}
