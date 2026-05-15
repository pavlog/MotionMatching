using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace MotionMatching.Importers;

public sealed class AssimpCliVisualFbxInspector : IVisualFbxInspector
{
    private readonly AssimpToolOptions _options;

    public AssimpCliVisualFbxInspector(AssimpToolOptions? options = null)
    {
        _options = options ?? new AssimpToolOptions();
    }

    public async Task<VisualFbxImportResult> InspectAsync(string fbxPath, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(fbxPath))
        {
            return VisualFbxValidator.Validate(VisualSceneInspection.Failed($"File does not exist: {Path.GetFileName(fbxPath)}"));
        }

        var result = await RunAssimpAsync("info", fbxPath, cancellationToken);
        if (result.ExitCode != 0)
        {
            return VisualFbxValidator.Validate(VisualSceneInspection.Failed(FirstNonEmpty(result.StandardError, result.StandardOutput)));
        }

        return VisualFbxValidator.Validate(AssimpCliInfoParser.Parse(result.StandardOutput));
    }

    private async Task<AssimpProcessResult> RunAssimpAsync(string command, string assetPath, CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = _options.ExecutablePath,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false
        };

        startInfo.ArgumentList.Add(command);
        startInfo.ArgumentList.Add(assetPath);

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
            return new AssimpProcessResult(127, string.Empty, exception.Message);
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync(cancellationToken);

        return new AssimpProcessResult(process.ExitCode, output.ToString(), error.ToString());
    }

    private static string FirstNonEmpty(params string[] values)
    {
        return values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? "Assimp failed.";
    }
}

public sealed record AssimpToolOptions
{
    public string ExecutablePath { get; init; } = "assimp";
}

internal sealed record AssimpProcessResult(
    int ExitCode,
    string StandardOutput,
    string StandardError);
