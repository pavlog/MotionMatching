using System.Text.Json.Serialization;

namespace MotionMatching.Authoring;

public sealed record CharacterManifest
{
    [JsonPropertyName("$schema")]
    public string Schema { get; init; } = "docs/schemas/motioncharacter.schema.json";

    public int SchemaVersion { get; init; } = 1;

    public required StudioId Id { get; init; }

    public required string Name { get; init; }

    public required string VisualManifestPath { get; init; }

    public List<string> ClipManifestPaths { get; init; } = [];
}
