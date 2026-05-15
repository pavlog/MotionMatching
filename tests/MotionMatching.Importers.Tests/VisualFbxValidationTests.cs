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
        Assert.Contains("Hips", scene.Skeletons[0].BoneNames);
        Assert.True(scene.HasMaterials);
        Assert.True(scene.HasTextures);
    }

    [Fact]
    public async Task SkeletonNameExtractorReadsBvhHierarchyBones()
    {
        var path = Path.Combine(Path.GetTempPath(), $"clip-{Guid.NewGuid():N}.bvh");
        await File.WriteAllTextAsync(path, """
            HIERARCHY
            ROOT Hips
            {
                JOINT Spine
                {
                    JOINT Head
                    {
                    }
                }
            }
            MOTION
            Frames: 1
            Frame Time: 0.0333333
            """);

        try
        {
            var extractor = new AssimpCliSkeletonNameExtractor();
            var result = await extractor.ExtractAsync(path, MotionMatching.Authoring.ClipSourceKind.Bvh);

            Assert.True(result.Succeeded);
            Assert.Contains("Hips", result.BoneNames);
            Assert.Contains("Spine", result.BoneNames);
            Assert.Contains("Head", result.BoneNames);
        }
        finally
        {
            File.Delete(path);
        }
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

    [Fact]
    public void GltfAnimationTimelineParserPrefersDominantFullDurationSamplerCount()
    {
        const string gltf = """
            {
              "animations": [
                {
                  "samplers": [
                    { "input": 0, "output": 1 },
                    { "input": 2, "output": 3 },
                    { "input": 4, "output": 5 },
                    { "input": 6, "output": 7 }
                  ]
                }
              ],
              "accessors": [
                { "count": 32, "type": "SCALAR", "min": [0], "max": [0.6333333333333333] },
                { "count": 32, "type": "VEC3" },
                { "count": 20, "type": "SCALAR", "min": [0], "max": [0.6333333333333333] },
                { "count": 20, "type": "VEC4" },
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

    [Fact]
    public void GltfRootMotionDiagnosticsParserReadsSkeletonDisplacement()
    {
        var binary = new byte[sizeof(float) * 6];
        WriteFloat(binary, 0, 2.0f);
        WriteFloat(binary, 4, -3.0f);
        WriteFloat(binary, 8, -11.0f);
        WriteFloat(binary, 12, 2.25f);
        WriteFloat(binary, 16, 5.0f);
        WriteFloat(binary, 20, 165.0f);
        const string gltf = """
            {
              "nodes": [
                { "name": "Skeleton" }
              ],
              "animations": [
                {
                  "samplers": [
                    { "input": 0, "output": 1 }
                  ],
                  "channels": [
                    { "sampler": 0, "target": { "node": 0, "path": "translation" } }
                  ]
                }
              ],
              "bufferViews": [
                { "buffer": 0, "byteOffset": 0, "byteLength": 24 }
              ],
              "accessors": [
                { "count": 2, "type": "SCALAR", "min": [0], "max": [0.6333333333333333] },
                { "bufferView": 0, "componentType": 5126, "count": 2, "type": "VEC3" }
              ]
            }
            """;

        var diagnostics = GltfRootMotionDiagnosticsParser.ParseGltfJson(gltf, binary);

        Assert.NotNull(diagnostics);
        Assert.Equal("Skeleton", diagnostics.SourceName);
        Assert.Equal(2, diagnostics.KeyCount);
        Assert.Equal(0.25, diagnostics.DisplacementX, precision: 3);
        Assert.Equal(8, diagnostics.DisplacementY, precision: 3);
        Assert.Equal(176, diagnostics.DisplacementZ, precision: 3);
        Assert.True(diagnostics.HorizontalDistance > 176);
        Assert.True(diagnostics.AverageHorizontalSpeed > 270);
    }

    [Fact]
    public void GltfFootContactDiagnosticsParserReadsLowVelocityRanges()
    {
        var binary = new byte[sizeof(float) * 4 + sizeof(float) * 3 * 4];
        WriteFloat(binary, 0, 0.0f);
        WriteFloat(binary, 4, 0.1f);
        WriteFloat(binary, 8, 0.2f);
        WriteFloat(binary, 12, 0.3f);
        WriteFloat(binary, 16, 0.0f);
        WriteFloat(binary, 20, 0.0f);
        WriteFloat(binary, 24, 0.0f);
        WriteFloat(binary, 28, 0.005f);
        WriteFloat(binary, 32, 0.0f);
        WriteFloat(binary, 36, 0.0f);
        WriteFloat(binary, 40, 0.01f);
        WriteFloat(binary, 44, 0.0f);
        WriteFloat(binary, 48, 0.0f);
        WriteFloat(binary, 52, 1.0f);
        WriteFloat(binary, 56, 0.0f);
        WriteFloat(binary, 60, 0.0f);
        const string gltf = """
            {
              "nodes": [
                { "name": "mixamorig:LeftFoot" }
              ],
              "animations": [
                {
                  "samplers": [
                    { "input": 0, "output": 1 }
                  ],
                  "channels": [
                    { "sampler": 0, "target": { "node": 0, "path": "translation" } }
                  ]
                }
              ],
              "bufferViews": [
                { "buffer": 0, "byteOffset": 0, "byteLength": 16 },
                { "buffer": 0, "byteOffset": 16, "byteLength": 48 }
              ],
              "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 4, "type": "SCALAR" },
                { "bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC3" }
              ]
            }
            """;

        var diagnostics = GltfFootContactDiagnosticsParser.ParseGltfJson(gltf, binary, velocityThreshold: 0.15);

        Assert.NotNull(diagnostics);
        var track = Assert.Single(diagnostics.Tracks);
        Assert.Equal("left", track.Foot);
        Assert.Equal("mixamorig:LeftFoot", track.SourceName);
        var range = Assert.Single(track.Ranges);
        Assert.Equal(0, range.StartFrame);
        Assert.Equal(2, range.EndFrame);
    }

    [Fact]
    public void GltfFootContactDiagnosticsParserUsesWorldSpaceParentMotion()
    {
        var binary = new byte[sizeof(float) * 4 + sizeof(float) * 4 * 4];
        WriteFloat(binary, 0, 0.0f);
        WriteFloat(binary, 4, 0.1f);
        WriteFloat(binary, 8, 0.2f);
        WriteFloat(binary, 12, 0.3f);

        WriteQuaternionY(binary, 16, 0.0f);
        WriteQuaternionY(binary, 32, 0.0f);
        WriteQuaternionY(binary, 48, 0.0f);
        WriteQuaternionY(binary, 64, MathF.PI / 2.0f);

        const string gltf = """
            {
              "nodes": [
                { "name": "Hips", "children": [1] },
                { "name": "mixamorig:LeftFoot", "translation": [1, 0, 0] }
              ],
              "animations": [
                {
                  "samplers": [
                    { "input": 0, "output": 1 }
                  ],
                  "channels": [
                    { "sampler": 0, "target": { "node": 0, "path": "rotation" } }
                  ]
                }
              ],
              "bufferViews": [
                { "buffer": 0, "byteOffset": 0, "byteLength": 16 },
                { "buffer": 0, "byteOffset": 16, "byteLength": 64 }
              ],
              "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 4, "type": "SCALAR" },
                { "bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC4" }
              ]
            }
            """;

        var diagnostics = GltfFootContactDiagnosticsParser.ParseGltfJson(gltf, binary, velocityThreshold: 0.01);

        Assert.NotNull(diagnostics);
        var track = Assert.Single(diagnostics.Tracks);
        var range = Assert.Single(track.Ranges);
        Assert.Equal(0, range.StartFrame);
        Assert.Equal(2, range.EndFrame);
    }

    private static void WriteFloat(byte[] buffer, int offset, float value)
    {
        BitConverter.GetBytes(value).CopyTo(buffer, offset);
    }

    private static void WriteQuaternionY(byte[] buffer, int offset, float radians)
    {
        WriteFloat(buffer, offset, 0.0f);
        WriteFloat(buffer, offset + 4, MathF.Sin(radians / 2.0f));
        WriteFloat(buffer, offset + 8, 0.0f);
        WriteFloat(buffer, offset + 12, MathF.Cos(radians / 2.0f));
    }
}
