namespace MotionMatching.Importers;

public interface IVisualFbxInspector
{
    Task<VisualFbxImportResult> InspectAsync(string fbxPath, CancellationToken cancellationToken = default);
}
