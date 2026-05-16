using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using MotionMatching.Authoring;

namespace MotionMatching.Importers;

public sealed partial class AssimpCliSkeletonNameExtractor : ISkeletonNameExtractor
{
    private readonly AssimpToolOptions _options;

    public AssimpCliSkeletonNameExtractor(AssimpToolOptions? options = null)
    {
        _options = options ?? new AssimpToolOptions();
    }

    public async Task<SkeletonNameExtractionResult> ExtractAsync(
        string assetPath,
        ClipSourceKind sourceKind,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(assetPath))
        {
            return SkeletonNameExtractionResult.Failed($"File does not exist: {Path.GetFileName(assetPath)}");
        }

        return sourceKind switch
        {
            ClipSourceKind.Bvh => SkeletonNameExtractionResult.Success(ReadBvhBoneNames(assetPath)),
            ClipSourceKind.Fbx => await ExtractFbxAsync(assetPath, cancellationToken),
            _ => SkeletonNameExtractionResult.Failed($"Unsupported skeleton source kind: {sourceKind}")
        };
    }

    private async Task<SkeletonNameExtractionResult> ExtractFbxAsync(string assetPath, CancellationToken cancellationToken)
    {
        var result = await RunAssimpInfoAsync(assetPath, cancellationToken);
        if (result.ExitCode != 0)
        {
            return SkeletonNameExtractionResult.Failed(FirstNonEmpty(result.StandardError, result.StandardOutput));
        }

        var scene = AssimpCliInfoParser.Parse(result.StandardOutput);
        var boneNames = scene.Skeletons.SelectMany(skeleton => skeleton.BoneNames).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (boneNames.Length == 0)
        {
            boneNames = AssimpCliInfoParser.ParseHierarchyNodeNames(result.StandardOutput)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        return boneNames.Length > 0
            ? SkeletonNameExtractionResult.Success(boneNames)
            : SkeletonNameExtractionResult.Failed("No skeleton node names were found.");
    }

    private static IReadOnlyList<string> ReadBvhBoneNames(string assetPath)
    {
        var names = new List<string>();
        foreach (var rawLine in File.ReadLines(assetPath).Take(8192))
        {
            var line = rawLine.Trim();
            if (line.Equals("MOTION", StringComparison.OrdinalIgnoreCase))
            {
                break;
            }

            var match = BvhJointRegex().Match(line);
            if (match.Success)
            {
                names.Add(match.Groups["name"].Value.Trim());
            }
        }

        return names.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private async Task<SkeletonInfoProcessResult> RunAssimpInfoAsync(string assetPath, CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = _options.ExecutablePath,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false
        };

        startInfo.ArgumentList.Add("info");
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
            return new SkeletonInfoProcessResult(127, string.Empty, exception.Message);
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync(cancellationToken);

        return new SkeletonInfoProcessResult(process.ExitCode, output.ToString(), error.ToString());
    }

    private static string FirstNonEmpty(params string[] values)
    {
        return values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? "Skeleton extraction failed.";
    }

    [GeneratedRegex(@"^(ROOT|JOINT)\s+(?<name>[^\s{]+)", RegexOptions.CultureInvariant)]
    private static partial Regex BvhJointRegex();
}

internal sealed record SkeletonInfoProcessResult(
    int ExitCode,
    string StandardOutput,
    string StandardError);
