using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using MotionMatching.Importers;

namespace MotionMatching.PreviewRuntime;

public sealed class PreviewGlbCacheService
{
    private readonly AssimpToolOptions _options;

    public PreviewGlbCacheService(AssimpToolOptions? options = null)
    {
        _options = options ?? new AssimpToolOptions();
    }

    public async Task<PreviewGlbCacheResult> GenerateAsync(
        string sourceFbxPath,
        string previewGlbPath,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(sourceFbxPath))
        {
            return new PreviewGlbCacheResult(false, previewGlbPath, false, $"Source FBX does not exist: {Path.GetFileName(sourceFbxPath)}");
        }

        if (IsCacheFresh(sourceFbxPath, previewGlbPath))
        {
            return new PreviewGlbCacheResult(true, previewGlbPath, false, null);
        }

        Directory.CreateDirectory(Path.GetDirectoryName(previewGlbPath) ?? throw new InvalidOperationException($"Path has no directory: {previewGlbPath}"));
        var result = await RunAssimpExportAsync(sourceFbxPath, previewGlbPath, cancellationToken);
        if (result.ExitCode != 0)
        {
            if (File.Exists(previewGlbPath))
            {
                File.Delete(previewGlbPath);
            }

            return new PreviewGlbCacheResult(false, previewGlbPath, false, FirstNonEmpty(result.StandardError, result.StandardOutput));
        }

        GlbTextureStripper.StripExternalTextureReferences(previewGlbPath);
        return new PreviewGlbCacheResult(true, previewGlbPath, true, null);
    }

    public static string GetDefaultPreviewPath(string characterRoot)
    {
        return Path.Combine(characterRoot, "Cache", "Preview", "visual.glb");
    }

    private static bool IsCacheFresh(string sourceFbxPath, string previewGlbPath)
    {
        return File.Exists(previewGlbPath) &&
            File.GetLastWriteTimeUtc(previewGlbPath) >= File.GetLastWriteTimeUtc(sourceFbxPath);
    }

    private async Task<AssimpExportResult> RunAssimpExportAsync(string sourceFbxPath, string previewGlbPath, CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = _options.ExecutablePath,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false
        };

        startInfo.ArgumentList.Add("export");
        startInfo.ArgumentList.Add(sourceFbxPath);
        startInfo.ArgumentList.Add(previewGlbPath);

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
            return new AssimpExportResult(127, string.Empty, exception.Message);
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync(cancellationToken);
        return new AssimpExportResult(process.ExitCode, output.ToString(), error.ToString());
    }

    private static string FirstNonEmpty(params string[] values)
    {
        return values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? "Assimp export failed.";
    }
}

internal sealed record AssimpExportResult(
    int ExitCode,
    string StandardOutput,
    string StandardError);
