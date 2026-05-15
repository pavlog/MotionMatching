using MotionMatching.Importers;
using MotionMatching.PreviewRuntime;

namespace MotionMatching.PreviewRuntime.Tests;

public sealed class PreviewGlbCacheServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"preview-cache-tests-{Guid.NewGuid():N}");

    public PreviewGlbCacheServiceTests()
    {
        Directory.CreateDirectory(_root);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    [Fact]
    public async Task GenerateAsyncCreatesGlbCacheFile()
    {
        var source = Path.Combine(_root, "source.fbx");
        var output = Path.Combine(_root, "Cache", "Preview", "visual.glb");
        await File.WriteAllTextAsync(source, "fbx");

        var service = new PreviewGlbCacheService(new AssimpToolOptions
        {
            ExecutablePath = CreateFakeAssimpTool()
        });

        var result = await service.GenerateAsync(source, output);

        Assert.True(result.Succeeded);
        Assert.True(result.Generated);
        Assert.Equal(output, result.PreviewFilePath);
        Assert.Equal("glb", await File.ReadAllTextAsync(output));
    }

    [Fact]
    public async Task GenerateAsyncReusesFreshCacheFile()
    {
        var source = Path.Combine(_root, "source.fbx");
        var output = Path.Combine(_root, "Cache", "Preview", "visual.glb");
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        await File.WriteAllTextAsync(source, "fbx");
        await File.WriteAllTextAsync(output, "existing");
        File.SetLastWriteTimeUtc(output, File.GetLastWriteTimeUtc(source).AddMinutes(1));

        var service = new PreviewGlbCacheService(new AssimpToolOptions
        {
            ExecutablePath = CreateFakeAssimpTool()
        });

        var result = await service.GenerateAsync(source, output);

        Assert.True(result.Succeeded);
        Assert.False(result.Generated);
        Assert.Equal("existing", await File.ReadAllTextAsync(output));
    }

    private string CreateFakeAssimpTool()
    {
        if (OperatingSystem.IsWindows())
        {
            var windowsTool = Path.Combine(_root, "fake-assimp.cmd");
            File.WriteAllText(windowsTool, "@echo off\r\n> \"%~3\" <nul set /p dummy=glb\r\nexit /b 0\r\n");
            return windowsTool;
        }

        var tool = Path.Combine(_root, "fake-assimp.sh");
        File.WriteAllText(tool, "#!/bin/sh\nprintf glb > \"$3\"\n");
        File.SetUnixFileMode(tool, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);

        return tool;
    }
}
