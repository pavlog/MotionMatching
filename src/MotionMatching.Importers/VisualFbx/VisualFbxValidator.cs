namespace MotionMatching.Importers;

public static class VisualFbxValidator
{
    public static VisualFbxImportResult Validate(VisualSceneInspection scene)
    {
        var findings = new List<ImporterFinding>();

        if (!scene.ImportSucceeded)
        {
            findings.Add(Error("import_failed", scene.ImportError ?? "The FBX could not be imported."));
        }

        if (scene.ImportSucceeded && scene.SkinnedMeshes.Count == 0)
        {
            findings.Add(Error("no_skinned_mesh", "The visual FBX must contain at least one skinned mesh."));
        }

        if (scene.ImportSucceeded && scene.Skeletons.Count == 0)
        {
            findings.Add(Error("no_skeleton", "The visual FBX must contain one canonical skeleton."));
        }

        if (scene.Skeletons.Count > 1)
        {
            findings.Add(Error("multiple_skeletons", "The visual FBX contains multiple independent skeletons."));
        }

        if (scene.SkinnedMeshes.Any(mesh => !mesh.HasBindPose))
        {
            findings.Add(Error("missing_bind_pose", "At least one skinned mesh is missing usable bind pose data."));
        }

        if (scene.ImportSucceeded && scene.SkinnedMeshes.Count > 0 && !scene.HasMaterials)
        {
            findings.Add(new ImporterFinding(
                "no_materials",
                ImporterFindingSeverity.Warning,
                "The visual FBX has skinned meshes but no material data."));
        }

        return new VisualFbxImportResult
        {
            CanCompile = findings.All(finding => finding.Severity != ImporterFindingSeverity.Error),
            Scene = scene,
            Findings = findings
        };
    }

    private static ImporterFinding Error(string code, string message)
    {
        return new ImporterFinding(code, ImporterFindingSeverity.Error, message);
    }
}
