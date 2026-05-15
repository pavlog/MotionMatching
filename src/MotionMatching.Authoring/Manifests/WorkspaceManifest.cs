using System.Text.Json.Serialization;

namespace MotionMatching.Authoring;

public sealed record WorkspaceManifest
{
    [JsonPropertyName("$schema")]
    public string Schema { get; init; } = "docs/schemas/motionworkspace.schema.json";

    public int SchemaVersion { get; init; } = 1;

    public required StudioId Id { get; init; }

    public required string Name { get; init; }

    public WorkspaceMode Mode { get; init; } = WorkspaceMode.Browser;

    public List<CharacterReference> Characters { get; init; } = [];
}

[JsonConverter(typeof(JsonStringEnumConverter<WorkspaceMode>))]
public enum WorkspaceMode
{
    Browser
}

public sealed record CharacterReference
{
    public required StudioId Id { get; init; }

    public required string Name { get; init; }

    public required string ManifestPath { get; init; }
}
