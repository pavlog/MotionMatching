using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace MotionMatching.Importers;

public sealed class AssimpCliClipTimelineExtractor : IClipTimelineExtractor
{
    private readonly AssimpToolOptions _options;

    public AssimpCliClipTimelineExtractor(AssimpToolOptions? options = null)
    {
        _options = options ?? new AssimpToolOptions();
    }

    public async Task<ClipTimelineMetadata?> ExtractAsync(string assetPath, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(assetPath))
        {
            return null;
        }

        var cacheRoot = Path.Combine(
            Path.GetDirectoryName(assetPath) ?? throw new InvalidOperationException($"Path has no directory: {assetPath}"),
            "Cache",
            "Timeline");
        Directory.CreateDirectory(cacheRoot);

        var glbPath = Path.Combine(cacheRoot, $"{Path.GetFileNameWithoutExtension(assetPath)}.timeline.glb");
        var result = await RunAssimpExportAsync(assetPath, glbPath, cancellationToken);
        if (result.ExitCode != 0 || !File.Exists(glbPath))
        {
            return null;
        }

        try
        {
            return GltfAnimationTimelineParser.ParseGlb(glbPath);
        }
        finally
        {
            File.Delete(glbPath);
        }
    }

    private async Task<AssimpClipProcessResult> RunAssimpExportAsync(
        string assetPath,
        string glbPath,
        CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = _options.ExecutablePath,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false
        };

        startInfo.ArgumentList.Add("export");
        startInfo.ArgumentList.Add(assetPath);
        startInfo.ArgumentList.Add(glbPath);

        using var process = new Process
        {
            StartInfo = startInfo
        };

        var output = new StringBuilder();
        var error = new StringBuilder();
        process.OutputDataReceived += (_, args) =>
        {
            if (args.Data is not null)
            {
                output.AppendLine(args.Data);
            }
        };
        process.ErrorDataReceived += (_, args) =>
        {
            if (args.Data is not null)
            {
                error.AppendLine(args.Data);
            }
        };

        try
        {
            process.Start();
        }
        catch (Exception exception) when (exception is Win32Exception or FileNotFoundException)
        {
            return new AssimpClipProcessResult(127, string.Empty, exception.Message);
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync(cancellationToken);

        return new AssimpClipProcessResult(process.ExitCode, output.ToString(), error.ToString());
    }
}

internal sealed record AssimpClipProcessResult(
    int ExitCode,
    string StandardOutput,
    string StandardError);
