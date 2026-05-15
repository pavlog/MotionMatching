using System.Text.RegularExpressions;

namespace MotionMatching.Importers;

public static partial class AssimpCliInfoParser
{
    public static VisualSceneInspection Parse(string infoOutput)
    {
        var meshSummaries = ParseMeshSummaries(infoOutput);
        var boneCount = ParseMetric(infoOutput, "Bones");
        var hierarchyNames = ParseHierarchyNodeNames(infoOutput);
        var materialCount = ParseMetric(infoOutput, "Materials");
        var embeddedTextureCount = ParseMetric(infoOutput, "Textures (embed.)");

        return new VisualSceneInspection
        {
            SkinnedMeshes = meshSummaries,
            Skeletons = boneCount > 0 ? [new SkeletonSummary(ParseSkeletonRoot(infoOutput), boneCount) { BoneNames = hierarchyNames }] : [],
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

    public static IReadOnlyList<string> ParseHierarchyNodeNames(string infoOutput)
    {
        var names = new List<string>();
        var inHierarchy = false;
        foreach (var line in infoOutput.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            if (!inHierarchy)
            {
                inHierarchy = line.Trim().Equals("Node hierarchy:", StringComparison.OrdinalIgnoreCase);
                continue;
            }

            var name = CleanHierarchyNodeName(line);
            if (!string.IsNullOrWhiteSpace(name) && !name.Equals("RootNode", StringComparison.OrdinalIgnoreCase))
            {
                names.Add(name);
            }
        }

        return names.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static string CleanHierarchyNodeName(string line)
    {
        var trimmed = line.Trim();
        var markerIndex = Math.Max(trimmed.LastIndexOf('╴'), trimmed.LastIndexOf('´'));
        if (markerIndex >= 0 && markerIndex + 1 < trimmed.Length)
        {
            trimmed = trimmed[(markerIndex + 1)..].Trim();
        }
        else
        {
            trimmed = Regex.Replace(trimmed, @"^[^\p{L}\p{N}_]+", string.Empty, RegexOptions.CultureInvariant).Trim();
        }

        var meshSuffixIndex = trimmed.IndexOf(" (mesh ", StringComparison.OrdinalIgnoreCase);
        if (meshSuffixIndex >= 0)
        {
            trimmed = trimmed[..meshSuffixIndex].Trim();
        }

        return trimmed;
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
