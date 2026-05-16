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
    public void AssimpCliInfoParserExtractsAnimationOnlyHierarchyNames()
    {
        const string info = """
            Meshes:             0
            Bones:              0
            Animation Channels: 46

            Node hierarchy:
            RootNode
            '-Skeleton
              '-Hips
                |-Spine
                | '-Chest
                '-Left_UpperLeg
                  '-Left_LowerLeg
                    '-Left_Foot
            """;

        var names = AssimpCliInfoParser.ParseHierarchyNodeNames(info);

        Assert.Contains("Skeleton", names);
        Assert.Contains("Hips", names);
        Assert.Contains("Spine", names);
        Assert.Contains("Left_Foot", names);
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
    public void GltfPoseSamplerReadsInterpolatedLocalBoneValues()
    {
        var binary = new byte[sizeof(float) * 2 + sizeof(float) * 3 * 2 + sizeof(float) * 4 * 2];
        WriteFloat(binary, 0, 0.0f);
        WriteFloat(binary, 4, 1.0f);
        WriteFloat(binary, 8, 0.0f);
        WriteFloat(binary, 12, 0.0f);
        WriteFloat(binary, 16, 0.0f);
        WriteFloat(binary, 20, 10.0f);
        WriteFloat(binary, 24, 2.0f);
        WriteFloat(binary, 28, -4.0f);
        WriteFloat(binary, 32, 0.0f);
        WriteFloat(binary, 36, 0.0f);
        WriteFloat(binary, 40, 0.0f);
        WriteFloat(binary, 44, 1.0f);
        WriteFloat(binary, 48, 0.0f);
        WriteFloat(binary, 52, 0.0f);
        WriteFloat(binary, 56, 0.70710677f);
        WriteFloat(binary, 60, 0.70710677f);
        const string gltf = """
            {
              "nodes": [
                { "name": "mixamorig:Hips" }
              ],
              "animations": [
                {
                  "samplers": [
                    { "input": 0, "output": 1 },
                    { "input": 0, "output": 2 }
                  ],
                  "channels": [
                    { "sampler": 0, "target": { "node": 0, "path": "translation" } },
                    { "sampler": 1, "target": { "node": 0, "path": "rotation" } }
                  ]
                }
              ],
              "bufferViews": [
                { "buffer": 0, "byteOffset": 0, "byteLength": 8 },
                { "buffer": 0, "byteOffset": 8, "byteLength": 24 },
                { "buffer": 0, "byteOffset": 32, "byteLength": 32 }
              ],
              "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 2, "type": "SCALAR" },
                { "bufferView": 1, "componentType": 5126, "count": 2, "type": "VEC3" },
                { "bufferView": 2, "componentType": 5126, "count": 2, "type": "VEC4" }
              ]
            }
            """;

        var samples = GltfPoseSampler.ParseGltfJson(gltf, binary, [0, 15], frameRate: 30, durationSeconds: 1, ["Hips"]);

        Assert.Equal(2, samples.Count);
        var mid = samples[1];
        var bone = Assert.Single(mid.Bones);
        Assert.Equal("mixamorig:Hips", bone.BoneName);
        Assert.Equal(5, bone.Translation[0], precision: 3);
        Assert.Equal(1, bone.Translation[1], precision: 3);
        Assert.Equal(-2, bone.Translation[2], precision: 3);
        Assert.Equal(0.5, mid.Seconds, precision: 3);
        Assert.Equal(1, bone.Scale[0], precision: 3);
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
    public void GltfFootContactDiagnosticsParserAllowsFullClipContactsForIdle()
    {
        var binary = new byte[sizeof(float) * 4 + sizeof(float) * 3 * 4];
        WriteFloat(binary, 0, 0.0f);
        WriteFloat(binary, 4, 0.1f);
        WriteFloat(binary, 8, 0.2f);
        WriteFloat(binary, 12, 0.3f);
        for (var offset = 16; offset < binary.Length; offset += 4)
        {
            WriteFloat(binary, offset, 0.0f);
        }

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

        var defaultDiagnostics = GltfFootContactDiagnosticsParser.ParseGltfJson(gltf, binary, velocityThreshold: 0.15);
        var idleDiagnostics = GltfFootContactDiagnosticsParser.ParseGltfJson(gltf, binary, velocityThreshold: 0.15, allowAlmostWholeClipContacts: true);

        Assert.Null(defaultDiagnostics);
        Assert.NotNull(idleDiagnostics);
        var track = Assert.Single(idleDiagnostics.Tracks);
        var range = Assert.Single(track.Ranges);
        Assert.Equal(0, range.StartFrame);
        Assert.Equal(3, range.EndFrame);
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

    [Fact]
    public void GltfFootContactDiagnosticsParserClosesSingleFrameContactGaps()
    {
        const int keyCount = 14;
        var binary = new byte[sizeof(float) * keyCount + sizeof(float) * 3 * keyCount];
        var positions = new[]
        {
            4.0f,
            0.0f,
            0.005f,
            0.010f,
            0.015f,
            0.020f,
            0.025f,
            0.030f,
            0.035f,
            1.0f,
            2.0f,
            2.005f,
            4.0f,
            6.0f
        };

        for (var index = 0; index < keyCount; index++)
        {
            WriteFloat(binary, index * sizeof(float), index * 0.1f);
            var positionOffset = sizeof(float) * keyCount + index * sizeof(float) * 3;
            WriteFloat(binary, positionOffset, positions[index]);
            WriteFloat(binary, positionOffset + 4, 0.0f);
            WriteFloat(binary, positionOffset + 8, 0.0f);
        }

        const string gltf = """
            {
              "nodes": [
                { "name": "mixamorig:RightFoot" }
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
                { "buffer": 0, "byteOffset": 0, "byteLength": 56 },
                { "buffer": 0, "byteOffset": 56, "byteLength": 168 }
              ],
              "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 14, "type": "SCALAR" },
                { "bufferView": 1, "componentType": 5126, "count": 14, "type": "VEC3" }
              ]
            }
            """;

        var diagnostics = GltfFootContactDiagnosticsParser.ParseGltfJson(gltf, binary, velocityThreshold: 0.15);

        Assert.NotNull(diagnostics);
        var track = Assert.Single(diagnostics.Tracks);
        var range = Assert.Single(track.Ranges);
        Assert.Equal(1, range.StartFrame);
        Assert.Equal(11, range.EndFrame);
    }

    [Fact]
    public void GltfFootContactDiagnosticsParserIncludesNearGroundTouchdownLeadFrame()
    {
        const int keyCount = 6;
        var binary = new byte[sizeof(float) * keyCount + sizeof(float) * 3 * keyCount];
        var positions = new[]
        {
            (X: 0.0f, Y: 20.0f),
            (X: 0.0f, Y: 4.0f),
            (X: 10.0f, Y: 1.0f),
            (X: 10.001f, Y: 1.0f),
            (X: 10.002f, Y: 1.0f),
            (X: 30.0f, Y: 20.0f)
        };

        for (var index = 0; index < keyCount; index++)
        {
            WriteFloat(binary, index * sizeof(float), index * 0.1f);
            var positionOffset = sizeof(float) * keyCount + index * sizeof(float) * 3;
            WriteFloat(binary, positionOffset, positions[index].X);
            WriteFloat(binary, positionOffset + 4, positions[index].Y);
            WriteFloat(binary, positionOffset + 8, 0.0f);
        }

        const string gltf = """
            {
              "nodes": [
                { "name": "mixamorig:RightFoot" }
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
                { "buffer": 0, "byteOffset": 0, "byteLength": 24 },
                { "buffer": 0, "byteOffset": 24, "byteLength": 72 }
              ],
              "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 6, "type": "SCALAR" },
                { "bufferView": 1, "componentType": 5126, "count": 6, "type": "VEC3" }
              ]
            }
            """;

        var diagnostics = GltfFootContactDiagnosticsParser.ParseGltfJson(gltf, binary, velocityThreshold: 15);

        Assert.NotNull(diagnostics);
        var track = Assert.Single(diagnostics.Tracks);
        var range = Assert.Single(track.Ranges);
        Assert.Equal(1, range.StartFrame);
        Assert.Equal(4, range.EndFrame);
    }

    [Fact]
    public void GltfFootContactDiagnosticsParserKeepsLoopBoundaryContactFrames()
    {
        var binary = new byte[sizeof(float) * 4 + sizeof(float) * 3 * 4];
        WriteFloat(binary, 0, 0.0f);
        WriteFloat(binary, 4, 0.1f);
        WriteFloat(binary, 8, 0.2f);
        WriteFloat(binary, 12, 0.3f);
        WriteFloat(binary, 16, 0.0f);
        WriteFloat(binary, 20, 0.0f);
        WriteFloat(binary, 24, 0.0f);
        WriteFloat(binary, 28, 10.0f);
        WriteFloat(binary, 32, 0.0f);
        WriteFloat(binary, 36, 0.0f);
        WriteFloat(binary, 40, 20.0f);
        WriteFloat(binary, 44, 0.0f);
        WriteFloat(binary, 48, 0.0f);
        WriteFloat(binary, 52, 0.0f);
        WriteFloat(binary, 56, 0.0f);
        WriteFloat(binary, 60, 0.0f);
        const string gltf = """
            {
              "nodes": [
                { "name": "mixamorig:RightFoot" }
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
        Assert.Equal("right", track.Foot);
        Assert.Collection(
            track.Ranges,
            range =>
            {
                Assert.Equal(0, range.StartFrame);
                Assert.Equal(0, range.EndFrame);
            },
            range =>
            {
                Assert.Equal(3, range.StartFrame);
                Assert.Equal(3, range.EndFrame);
            });
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
