namespace MotionMatching.Builder.Tests;

public class BuilderProjectTests
{
    [Fact]
    public void BuilderAssemblyMarkerIsAvailable()
    {
        Assert.Equal("MotionMatching.Builder", global::MotionMatching.Builder.MotionMatchingBuilderMarker.AssemblyName);
    }
}
