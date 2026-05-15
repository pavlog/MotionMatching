using System.Text.RegularExpressions;

namespace MotionMatching.Importers;

public static partial class AssimpCliInfoParser
{
    public static VisualSceneInspection Parse(string infoOutput)
    {
        var meshSummaries = ParseMeshSummaries(infoOutput);
        var boneCount = ParseMetric(infoOutput, "Bones");
        var materialCount = ParseMetric(infoOutput, "Materials");
        var embeddedTextureCount = ParseMetric(infoOutput, "Textures (embed.)");

        return new VisualSceneInspection
        {
            SkinnedMeshes = meshSummaries,
            Skeletons = boneCount > 0 ? [new SkeletonSummary(ParseSkeletonRoot(infoOutput), boneCount)] : [],
            HasMaterials = materialCount > 0,
            HasTextures = embeddedTextureCount > 0 || HasTextureRefs(infoOutput)
        };
    }

    private static IReadOnlyList<SkinnedMeshSummary> ParseMeshSummaries(string infoOutput)
    {
        var meshes = new List<SkinnedMeshSummary>();
        foreach (Match match in MeshLineRegex().Matches(infoOutput))
        {
            var boneCount = int.Parse(match.Groups["bones"].Value);
            if (boneCount <= 0)
            {
                continue;
            }

            meshes.Add(new SkinnedMeshSummary(
                match.Groups["name"].Value,
                int.Parse(match.Groups["verts"].Value),
                boneCount,
                HasBindPose: true));
        }

        return meshes;
    }

    private static int ParseMetric(string infoOutput, string metricName)
    {
        var match = Regex.Match(
            infoOutput,
            $@"^\s*{Regex.Escape(metricName)}:\s+(?<value>\d+)",
            RegexOptions.Multiline | RegexOptions.CultureInvariant);

        return match.Success ? int.Parse(match.Groups["value"].Value) : 0;
    }

    private static string ParseSkeletonRoot(string infoOutput)
    {
        var match = SkeletonRootRegex().Match(infoOutput);
        return match.Success ? match.Groups["name"].Value.Trim() : "Skeleton";
    }

    private static bool HasTextureRefs(string infoOutput)
    {
        return TextureRefsRegex().IsMatch(infoOutput);
    }

    [GeneratedRegex(@"^\s+\d+\s+\((?<name>[^)]*)\):\s+\[(?<verts>\d+)\s+/\s+(?<bones>\d+)\s+/", RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex MeshLineRegex();

    [GeneratedRegex(@"^RootNode\s*\n\s*[├└]╴(?<name>.+)$", RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex SkeletonRootRegex();

    [GeneratedRegex(@"Texture Refs:\s*\n\s+'", RegexOptions.CultureInvariant)]
    private static partial Regex TextureRefsRegex();
}
