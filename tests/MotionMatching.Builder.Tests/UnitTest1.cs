namespace MotionMatching.Builder.Tests;

public class BuilderProjectTests
{
    [Fact]
    public void BuilderAssemblyMarkerIsAvailable()
    {
        Assert.Equal("MotionMatching.Builder", global::MotionMatching.Builder.MotionMatchingBuilderMarker.AssemblyName);
    }

    [Fact]
    public void BuildPlanAddsMirroredCopyForIncludedMirrorClips()
    {
        var clips = new[]
        {
            MotionMatching.Authoring.ClipManifest.FromUploadedSource(
                MotionMatching.Authoring.StudioId.FromKnown("clp_111111111111"),
                "RunForward",
                "RunForward.fbx",
                128) with
            {
                MirrorInBuild = true
            },
            MotionMatching.Authoring.ClipManifest.FromUploadedSource(
                MotionMatching.Authoring.StudioId.FromKnown("clp_222222222222"),
                "DebugExcluded",
                "DebugExcluded.fbx",
                128) with
            {
                IncludeInBuild = false,
                MirrorInBuild = true
            }
        };

        var entries = ClipBuildPlan.ExpandIncludedClips(clips);

        Assert.Collection(
            entries,
            entry =>
            {
                Assert.Equal("clp_111111111111", entry.SourceClipId);
                Assert.Equal("RunForward", entry.Name);
                Assert.False(entry.IsMirrored);
            },
            entry =>
            {
                Assert.Equal("clp_111111111111", entry.SourceClipId);
                Assert.Equal("RunForward Mirror", entry.Name);
                Assert.True(entry.IsMirrored);
            });
    }
}
