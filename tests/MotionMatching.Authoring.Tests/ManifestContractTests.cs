using System.Text.Json;
using System.Text.RegularExpressions;
using Json.Schema;
using MotionMatching.Authoring;

namespace MotionMatching.Authoring.Tests;

public class ManifestContractTests
{
    [Fact]
    public void StudioIdsUseShortPrefixedShape()
    {
        var id = StudioId.New("chr");

        Assert.Matches(new Regex("^chr_[a-f0-9]{12}$"), id.Value);
    }

    [Fact]
    public void VisualManifestStoresOnlyPortableSourceMetadata()
    {
        var visual = VisualManifest.FromUploadedSource(
            StudioId.FromKnown("vis_111111111111"),
            "/tmp/imports/IyoMixamo.fbx",
            42_000);

        var json = ManifestJson.Serialize(visual);

        Assert.Equal("IyoMixamo.fbx", visual.SourceFileName);
        Assert.Equal("Visual/source.fbx", visual.ManagedSourcePath);
        Assert.DoesNotContain("/tmp/imports", json);
    }

    [Fact]
    public void ClipManifestStoresOnlyPortableSourceMetadata()
    {
        var clip = ClipManifest.FromUploadedSource(
            StudioId.FromKnown("clp_111111111111"),
            "RunForward",
            @"C:\imports\RunForward.bvh",
            128_000);

        var json = ManifestJson.Serialize(clip);

        Assert.Equal("RunForward.bvh", clip.SourceFileName);
        Assert.Equal("source.bvh", clip.ManagedSourcePath);
        Assert.Equal(ClipSourceKind.Bvh, clip.SourceKind);
        Assert.False(clip.MirrorInBuild);
        Assert.Contains("\"mirrorInBuild\": false", json);
        Assert.Equal(ContactDetectionPreset.Auto, clip.ContactDetectionPreset);
        Assert.Contains("\"contactDetectionPreset\": \"auto\"", json);
        Assert.DoesNotContain("C:", json);
        Assert.DoesNotContain("imports", json);
    }

    [Fact]
    public void WorkspaceManifestRoundTripsWithStablePrettyJson()
    {
        var workspace = new WorkspaceManifest
        {
            Id = StudioId.FromKnown("wrk_111111111111"),
            Name = "Browser Workspace",
            Mode = WorkspaceMode.Browser,
            Characters =
            [
                new CharacterReference
                {
                    Id = StudioId.FromKnown("chr_222222222222"),
                    Name = "Iyo",
                    ManifestPath = "Characters/Iyo/character.json"
                }
            ]
        };

        var first = ManifestJson.Serialize(workspace);
        var second = ManifestJson.Serialize(workspace);
        var restored = ManifestJson.Deserialize<WorkspaceManifest>(first);

        Assert.Equal(first, second);
        Assert.Contains("\"schemaVersion\": 1", first);
        Assert.Contains("\"mode\": \"browser\"", first);
        Assert.Equal("Browser Workspace", restored.Name);
        Assert.Single(restored.Characters);
        Assert.Equal("Characters/Iyo/character.json", restored.Characters[0].ManifestPath);
    }

    [Theory]
    [InlineData("motionworkspace.schema.json", "workspace")]
    [InlineData("motioncharacter.schema.json", "character")]
    [InlineData("motionvisual.schema.json", "visual")]
    [InlineData("motionclip.schema.json", "clip")]
    public void ManifestSamplesValidateAgainstJsonSchemas(string schemaFile, string sampleName)
    {
        var schema = JsonSchema.FromText(File.ReadAllText(Path.Combine(FindRepoRoot(), "docs", "schemas", schemaFile)));
        var sample = sampleName switch
        {
            "workspace" => ManifestJson.Serialize(SampleWorkspace()),
            "character" => ManifestJson.Serialize(SampleCharacter()),
            "visual" => ManifestJson.Serialize(SampleVisual()),
            "clip" => ManifestJson.Serialize(SampleClip()),
            _ => throw new ArgumentOutOfRangeException(nameof(sampleName))
        };

        using var sampleJson = JsonDocument.Parse(sample);
        var result = schema.Evaluate(sampleJson.RootElement, new EvaluationOptions
        {
            OutputFormat = OutputFormat.List
        });

        Assert.True(result.IsValid, result.ToString());
    }

    private static WorkspaceManifest SampleWorkspace()
    {
        return new WorkspaceManifest
        {
            Id = StudioId.FromKnown("wrk_111111111111"),
            Name = "Browser Workspace",
            Mode = WorkspaceMode.Browser,
            Characters =
            [
                new CharacterReference
                {
                    Id = StudioId.FromKnown("chr_222222222222"),
                    Name = "Iyo",
                    ManifestPath = "Characters/Iyo/character.json"
                }
            ]
        };
    }

    private static CharacterManifest SampleCharacter()
    {
        return new CharacterManifest
        {
            Id = StudioId.FromKnown("chr_222222222222"),
            Name = "Iyo",
            VisualManifestPath = "Visual/visual.json"
        };
    }

    private static VisualManifest SampleVisual()
    {
        return VisualManifest.FromUploadedSource(
            StudioId.FromKnown("vis_333333333333"),
            "IyoMixamo.fbx",
            42_000);
    }

    private static ClipManifest SampleClip()
    {
        return ClipManifest.FromUploadedSource(
            StudioId.FromKnown("clp_444444444444"),
            "RunForward",
            "RunForward.fbx",
            128_000);
    }

    private static string FindRepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "MotionMatchingStudio.sln")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate repository root.");
    }
}
