using Microsoft.Extensions.Options;
using MotionMatching.Importers;
using MotionMatching.PreviewRuntime;
using MotionMatching.Studio.Backend.Workspaces;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<StudioBackendOptions>(builder.Configuration.GetSection("Studio"));
builder.Services.PostConfigure<StudioBackendOptions>(options =>
{
    if (!Path.IsPathRooted(options.WorkspaceRoot))
    {
        options.WorkspaceRoot = Path.Combine(FindRepoRoot(builder.Environment.ContentRootPath), options.WorkspaceRoot);
    }
});
builder.Services.AddSingleton(new AssimpToolOptions
{
    ExecutablePath = ResolveAssimpExecutable(builder.Configuration)
});
builder.Services.AddSingleton<IVisualFbxInspector>(services =>
    new AssimpCliVisualFbxInspector(services.GetRequiredService<AssimpToolOptions>()));
builder.Services.AddSingleton<IClipTimelineExtractor>(services =>
    new AssimpCliClipTimelineExtractor(services.GetRequiredService<AssimpToolOptions>()));
builder.Services.AddSingleton<ISkeletonNameExtractor>(services =>
    new AssimpCliSkeletonNameExtractor(services.GetRequiredService<AssimpToolOptions>()));
builder.Services.AddSingleton(services =>
    new PreviewGlbCacheService(services.GetRequiredService<AssimpToolOptions>()));
builder.Services.AddSingleton<BrowserWorkspaceService>();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy
            .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors();

app.MapGet("/api/v1/health", () => Results.Ok(new
{
    status = "ok",
    service = "motionmatching-studio-backend"
}));

app.MapGet("/api/v1/workspaces/browser", async (BrowserWorkspaceService workspaceService, CancellationToken cancellationToken) =>
{
    var workspace = await workspaceService.TryOpenBrowserWorkspaceAsync(cancellationToken);
    return workspace is null ? Results.NotFound() : Results.Ok(workspace);
});

app.MapPost("/api/v1/workspaces/browser", async (BrowserWorkspaceService workspaceService, CancellationToken cancellationToken) =>
{
    var workspace = await workspaceService.CreateOrOpenBrowserWorkspaceAsync(cancellationToken);
    return Results.Ok(workspace);
});

app.MapPost("/api/v1/workspaces/browser/characters", async (
    HttpRequest request,
    BrowserWorkspaceService workspaceService,
    IOptions<StudioBackendOptions> options,
    CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
    {
        return Results.BadRequest(new { error = "multipart_form_required" });
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var visual = form.Files.GetFile("visual");
    if (visual is null)
    {
        return Results.BadRequest(new { error = "visual_file_required" });
    }

    if (visual.Length > options.Value.MaxUploadBytes)
    {
        return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
    }

    var result = await workspaceService.ImportVisualCharacterAsync(visual, cancellationToken);
    return Results.Ok(result);
})
.DisableAntiforgery();

app.MapPost("/api/v1/workspaces/browser/characters/{characterId}/clips", async (
    string characterId,
    HttpRequest request,
    BrowserWorkspaceService workspaceService,
    IOptions<StudioBackendOptions> options,
    CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
    {
        return Results.BadRequest(new { error = "multipart_form_required" });
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var clip = form.Files.GetFile("clip");
    if (clip is null)
    {
        return Results.BadRequest(new { error = "clip_file_required" });
    }

    if (clip.Length > options.Value.MaxUploadBytes)
    {
        return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
    }

    try
    {
        var result = await workspaceService.ImportClipAsync(characterId, clip, cancellationToken);
        return Results.Ok(result);
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = "invalid_clip", message = exception.Message });
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { error = "clip_import_failed", message = exception.Message });
    }
})
.DisableAntiforgery();

app.MapDelete("/api/v1/workspaces/browser/characters/{characterId}", async (
    string characterId,
    BrowserWorkspaceService workspaceService,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await workspaceService.DeleteCharacterAsync(characterId, cancellationToken);
        return Results.Ok(result);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = "character_not_found", message = exception.Message });
    }
});

app.MapPost("/api/v1/workspaces/browser/characters/{characterId}/build-report", async (
    string characterId,
    BrowserWorkspaceService workspaceService,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await workspaceService.GenerateBuildReportAsync(characterId, cancellationToken);
        return Results.Ok(result);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = "character_not_found", message = exception.Message });
    }
});

app.MapGet("/api/v1/workspaces/browser/characters/{characterId}/build-report", async (
    string characterId,
    BrowserWorkspaceService workspaceService,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await workspaceService.GetBuildReportAsync(characterId, cancellationToken);
        return Results.Ok(result);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = "character_not_found", message = exception.Message });
    }
    catch (FileNotFoundException exception)
    {
        return Results.NotFound(new { error = "build_report_not_found", message = exception.Message });
    }
});

app.MapPost("/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}/replace-source", async (
    string characterId,
    string clipId,
    HttpRequest request,
    BrowserWorkspaceService workspaceService,
    IOptions<StudioBackendOptions> options,
    CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
    {
        return Results.BadRequest(new { error = "multipart_form_required" });
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var clip = form.Files.GetFile("clip");
    if (clip is null)
    {
        return Results.BadRequest(new { error = "clip_file_required" });
    }

    if (clip.Length > options.Value.MaxUploadBytes)
    {
        return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
    }

    try
    {
        var result = await workspaceService.ReplaceClipSourceAsync(characterId, clipId, clip, cancellationToken);
        return Results.Ok(result);
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = "invalid_clip", message = exception.Message });
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = "clip_not_found", message = exception.Message });
    }
})
.DisableAntiforgery();

app.MapDelete("/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}", async (
    string characterId,
    string clipId,
    BrowserWorkspaceService workspaceService,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await workspaceService.DeleteClipAsync(characterId, clipId, cancellationToken);
        return Results.Ok(result);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = "clip_not_found", message = exception.Message });
    }
});

app.MapPatch("/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}/settings", async (
    string characterId,
    string clipId,
    ClipSettingsRequest request,
    BrowserWorkspaceService workspaceService,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await workspaceService.UpdateClipSettingsAsync(characterId, clipId, request, cancellationToken);
        return Results.Ok(result);
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = "invalid_clip_settings", message = exception.Message });
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = "clip_not_found", message = exception.Message });
    }
});

app.MapPost("/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}/foot-contacts/refresh", async (
    string characterId,
    string clipId,
    BrowserWorkspaceService workspaceService,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await workspaceService.RefreshClipFootContactsAsync(characterId, clipId, cancellationToken);
        return Results.Ok(result);
    }
    catch (KeyNotFoundException exception)
    {
        return Results.NotFound(new { error = "clip_not_found", message = exception.Message });
    }
});

app.MapGet("/api/v1/workspaces/browser/assets/{**assetPath}", (
    string assetPath,
    IOptions<StudioBackendOptions> options) =>
{
    var workspaceRoot = Path.GetFullPath(options.Value.WorkspaceRoot);
    var requestedPath = Path.GetFullPath(Path.Combine(workspaceRoot, assetPath.Replace('/', Path.DirectorySeparatorChar)));
    if (!requestedPath.StartsWith(workspaceRoot, StringComparison.Ordinal) || !File.Exists(requestedPath))
    {
        return Results.NotFound();
    }

    var contentType = Path.GetExtension(requestedPath).Equals(".glb", StringComparison.OrdinalIgnoreCase)
        ? "model/gltf-binary"
        : "application/octet-stream";

    return Results.File(requestedPath, contentType);
});

app.Run();

static string ResolveAssimpExecutable(IConfiguration configuration)
{
    var configured = configuration["Assimp:ExecutablePath"];
    if (!string.IsNullOrWhiteSpace(configured))
    {
        return configured;
    }

    const string homebrewAssimp = "/opt/homebrew/bin/assimp";
    return File.Exists(homebrewAssimp) ? homebrewAssimp : "assimp";
}

static string FindRepoRoot(string startPath)
{
    var directory = new DirectoryInfo(startPath);
    while (directory is not null)
    {
        if (File.Exists(Path.Combine(directory.FullName, "MotionMatchingStudio.sln")))
        {
            return directory.FullName;
        }

        directory = directory.Parent;
    }

    return startPath;
}

public partial class Program;
