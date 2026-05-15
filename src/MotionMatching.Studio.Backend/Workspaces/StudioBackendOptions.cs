namespace MotionMatching.Studio.Backend.Workspaces;

public sealed class StudioBackendOptions
{
    public string WorkspaceRoot { get; set; } = Path.Combine(".motionstudio", "browser-workspace");

    public long MaxUploadBytes { get; set; } = 50L * 1024L * 1024L;
}
