using MotionMatching.Importers;

namespace MotionMatching.Importers.Tests;

public class VisualFbxValidationTests
{
    [Fact]
    public void ImportFailureIsHardError()
    {
        var result = VisualFbxValidator.Validate(VisualSceneInspection.Failed("Could not read FBX."));

        Assert.False(result.CanCompile);
        Assert.Contains(result.Findings, finding => finding.Code == "import_failed" && finding.Severity == ImporterFindingSeverity.Error);
    }

    [Fact]
    public void SceneWithoutSkinnedMeshIsHardError()
    {
        var result = VisualFbxValidator.Validate(new VisualSceneInspection
        {
            Skeletons = [new SkeletonSummary("Hips", 42)]
        });

        Assert.False(result.CanCompile);
        Assert.Contains(result.Findings, finding => finding.Code == "no_skinned_mesh");
    }

    [Fact]
    public void SceneWithoutSkeletonIsHardError()
    {
        var result = VisualFbxValidator.Validate(new VisualSceneInspection
        {
            SkinnedMeshes = [new SkinnedMeshSummary("Body", 1000, 42, HasBindPose: true)]
        });

        Assert.False(result.CanCompile);
        Assert.Contains(result.Findings, finding => finding.Code == "no_skeleton");
    }

    [Fact]
    public void MultipleIndependentSkeletonsAreHardError()
    {
        var result = VisualFbxValidator.Validate(new VisualSceneInspection
        {
            SkinnedMeshes = [new SkinnedMeshSummary("Body", 1000, 42, HasBindPose: true)],
            Skeletons =
            [
                new SkeletonSummary("RigA", 42),
                new SkeletonSummary("RigB", 39)
            ]
        });

        Assert.False(result.CanCompile);
        Assert.Contains(result.Findings, finding => finding.Code == "multiple_skeletons");
    }

    [Fact]
    public void MissingBindPoseIsHardError()
    {
        var result = VisualFbxValidator.Validate(new VisualSceneInspection
        {
            SkinnedMeshes = [new SkinnedMeshSummary("Body", 1000, 42, HasBindPose: false)],
            Skeletons = [new SkeletonSummary("Hips", 42)]
        });

        Assert.False(result.CanCompile);
        Assert.Contains(result.Findings, finding => finding.Code == "missing_bind_pose");
    }

    [Fact]
    public void ValidSingleSkeletonSceneCanCompile()
    {
        var result = VisualFbxValidator.Validate(new VisualSceneInspection
        {
            SkinnedMeshes = [new SkinnedMeshSummary("Body", 1000, 42, HasBindPose: true)],
            Skeletons = [new SkeletonSummary("Hips", 42)],
            HasMaterials = true
        });

        Assert.True(result.CanCompile);
        Assert.Empty(result.Findings.Where(finding => finding.Severity == ImporterFindingSeverity.Error));
    }

    [Fact]
    public void AssimpCliInfoParserExtractsVisualSummary()
    {
        const string info = """
            Meshes:             1
            Textures (embed.):  0
            Materials:          1
            Bones:              57

            Meshes:  (name) [vertices / bones / faces | primitive_types]
                0 (Geometry): [14311 / 57 / 9665 | triangle]

            Texture Refs:
                'textures/body_basecolor.png'

            Node hierarchy:
            RootNode
            ├╴Skeleton
            │ └╴Hips
            └╴Geometry (mesh 0)
            """;

        var scene = AssimpCliInfoParser.Parse(info);

        Assert.Single(scene.SkinnedMeshes);
        Assert.Equal("Geometry", scene.SkinnedMeshes[0].Name);
        Assert.Equal(14311, scene.SkinnedMeshes[0].VertexCount);
        Assert.Single(scene.Skeletons);
        Assert.Equal("Skeleton", scene.Skeletons[0].RootBoneName);
        Assert.True(scene.HasMaterials);
        Assert.True(scene.HasTextures);
    }

    [Fact]
    public void GltfAnimationTimelineParserExtractsLargestAnimationTimeRange()
    {
        const string gltf = """
            {
              "animations": [
                {
                  "samplers": [
                    { "input": 0, "output": 1 },
                    { "input": 2, "output": 3 }
                  ]
                }
              ],
              "accessors": [
                { "count": 20, "type": "SCALAR", "min": [0], "max": [0.6333333333333333] },
                { "count": 20, "type": "VEC3" },
                { "count": 4, "type": "SCALAR", "min": [0], "max": [0.1] },
                { "count": 4, "type": "VEC4" }
              ]
            }
            """;

        var timeline = GltfAnimationTimelineParser.ParseGltfJson(gltf);

        Assert.NotNull(timeline);
        Assert.Equal(20, timeline.FrameCount);
        Assert.Equal(30, timeline.FrameRate, precision: 3);
        Assert.Equal(0.6333333333333333, timeline.DurationSeconds, precision: 6);
    }
}
