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

    public List<SamplingQueryManifest> Samplings { get; init; } = [];

    public RuntimeBuildSettings RuntimeBuildSettings { get; init; } = new();
}

public sealed record SamplingQueryManifest
{
    public required StudioId Id { get; init; }

    public required string Name { get; init; }

    public string? RoleFilter { get; init; }

    public SamplingCapsuleManifest Capsule { get; init; } = new();

    public double[] Facing { get; init; } = [0, 0, 1];

    public double[] Velocity { get; init; } = [0, 0, 1];

    public List<SamplingTrajectoryPointManifest> Trajectory { get; init; } =
    [
        new() { FrameOffset = 20, Position = [0, 0, 28], Direction = [0, 0, 1] },
        new() { FrameOffset = 40, Position = [10, 0, 60], Direction = [0, 0, 1] },
        new() { FrameOffset = 60, Position = [18, 0, 96], Direction = [0, 0, 1] }
    ];
}

public sealed record SamplingCapsuleManifest
{
    public double Height { get; init; } = 72;

    public double Radius { get; init; } = 14;
}

public sealed record SamplingTrajectoryPointManifest
{
    public int FrameOffset { get; init; }

    public double[] Position { get; init; } = [0, 0, 0];

    public double[] Direction { get; init; } = [0, 0, 1];
}

public sealed record RuntimeBuildSettings
{
    public int SampleFrameStep { get; init; } = 1;

    public string ScaleMode { get; init; } = "auto";
}
