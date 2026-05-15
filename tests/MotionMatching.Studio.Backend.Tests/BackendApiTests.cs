using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using MotionMatching.Authoring;
using MotionMatching.Importers;

namespace MotionMatching.Studio.Backend.Tests;

public sealed class BackendApiTests : IAsyncLifetime
{
    private readonly string _workspaceRoot = Path.Combine(Path.GetTempPath(), $"motionstudio-tests-{Guid.NewGuid():N}");

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_workspaceRoot);
        await Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        if (Directory.Exists(_workspaceRoot))
        {
            Directory.Delete(_workspaceRoot, recursive: true);
        }

        return Task.CompletedTask;
    }

    [Fact]
    public async Task CreateBrowserWorkspaceWritesPortableWorkspaceManifest()
    {
        await using var factory = CreateFactory();
        var client = factory.CreateClient();

        var response = await client.PostAsync("/api/v1/workspaces/browser", content: null);
        var json = await response.Content.ReadAsStringAsync();

        response.EnsureSuccessStatusCode();
        Assert.Contains("\"mode\":\"browser\"", json);
        Assert.True(File.Exists(Path.Combine(_workspaceRoot, "workspace.json")));
        Assert.DoesNotContain(Environment.UserName, await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "workspace.json")));
    }

    [Fact]
    public async Task UploadVisualFbxCreatesCharacterFilesAndDoesNotPersistOriginalPath()
    {
        await using var factory = CreateFactory();
        var client = factory.CreateClient();
        await client.PostAsync("/api/v1/workspaces/browser", content: null);

        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("fake fbx bytes")), "visual", "IyoMixamo.fbx");

        var response = await client.PostAsync("/api/v1/workspaces/browser/characters", form);
        var responseJson = await response.Content.ReadAsStringAsync();

        response.EnsureSuccessStatusCode();
        Assert.Contains("\"name\":\"IyoMixamo\"", responseJson);
        Assert.True(File.Exists(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Visual", "source.fbx")));
        Assert.True(File.Exists(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Visual", "visual.json")));
        Assert.True(File.Exists(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "character.json")));

        var visualJson = await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Visual", "visual.json"));
        Assert.Contains("\"sourceFileName\": \"IyoMixamo.fbx\"", visualJson);
        Assert.DoesNotContain(_workspaceRoot, visualJson);
        Assert.DoesNotContain(Path.GetTempPath(), visualJson);

        using var workspaceJson = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "workspace.json")));
        Assert.Equal("Characters/IyoMixamo/character.json", workspaceJson.RootElement.GetProperty("characters")[0].GetProperty("manifestPath").GetString());
    }

    [Fact]
    public async Task UploadClipCreatesClipFilesAndUpdatesCharacterManifest()
    {
        await using var factory = CreateFactory();
        var client = factory.CreateClient();
        await client.PostAsync("/api/v1/workspaces/browser", content: null);

        using var characterForm = new MultipartFormDataContent();
        characterForm.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("fake fbx bytes")), "visual", "IyoMixamo.fbx");

        var characterResponse = await client.PostAsync("/api/v1/workspaces/browser/characters", characterForm);
        characterResponse.EnsureSuccessStatusCode();
        using var characterJson = JsonDocument.Parse(await characterResponse.Content.ReadAsStringAsync());
        var characterId = characterJson.RootElement.GetProperty("id").GetString();

        using var clipForm = new MultipartFormDataContent();
        clipForm.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("HIERARCHY\nROOT Hips\nMOTION\nFrames: 42\nFrame Time: 0.0333333\n")), "clip", "RunForward.bvh");

        var clipResponse = await client.PostAsync($"/api/v1/workspaces/browser/characters/{characterId}/clips", clipForm);
        var responseJson = await clipResponse.Content.ReadAsStringAsync();

        clipResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"name\":\"IyoMixamo\"", responseJson);
        Assert.Contains("\"clips\":[", responseJson);
        Assert.Contains("\"name\":\"RunForward\"", responseJson);
        Assert.Contains("\"frameCount\":42", responseJson);
        Assert.True(File.Exists(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Clips", "RunForward", "source.bvh")));
        Assert.True(File.Exists(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Clips", "RunForward", "clip.json")));

        var clipJson = await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Clips", "RunForward", "clip.json"));
        Assert.Contains("\"sourceKind\": \"bvh\"", clipJson);
        Assert.Contains("\"managedSourcePath\": \"source.bvh\"", clipJson);
        Assert.Contains("\"frameCount\": 42", clipJson);
        Assert.Contains("\"frameRate\":", clipJson);
        Assert.Contains("\"durationSeconds\":", clipJson);
        Assert.DoesNotContain(_workspaceRoot, clipJson);
        Assert.DoesNotContain(Path.GetTempPath(), clipJson);

        var characterManifestJson = await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "character.json"));
        Assert.Contains("\"Clips/RunForward/clip.json\"", characterManifestJson);
    }

    [Fact]
    public async Task UploadFbxClipStoresTimelineMetadataFromImporter()
    {
        await using var factory = CreateFactory();
        var client = factory.CreateClient();
        await client.PostAsync("/api/v1/workspaces/browser", content: null);

        using var characterForm = new MultipartFormDataContent();
        characterForm.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("fake fbx bytes")), "visual", "IyoMixamo.fbx");

        var characterResponse = await client.PostAsync("/api/v1/workspaces/browser/characters", characterForm);
        characterResponse.EnsureSuccessStatusCode();
        using var characterJson = JsonDocument.Parse(await characterResponse.Content.ReadAsStringAsync());
        var characterId = characterJson.RootElement.GetProperty("id").GetString();

        using var clipForm = new MultipartFormDataContent();
        clipForm.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("fake fbx clip bytes")), "clip", "RunForward.fbx");

        var clipResponse = await client.PostAsync($"/api/v1/workspaces/browser/characters/{characterId}/clips", clipForm);
        var responseJson = await clipResponse.Content.ReadAsStringAsync();

        clipResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"sourceKind\":\"fbx\"", responseJson);
        Assert.Contains("\"frameCount\":20", responseJson);
        Assert.Contains("\"frameRate\":30", responseJson);
        Assert.Contains("\"durationSeconds\":0.6333333333333333", responseJson);

        var clipJson = await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Clips", "RunForward", "clip.json"));
        Assert.Contains("\"frameCount\": 20", clipJson);
        Assert.Contains("\"frameRate\": 30", clipJson);
        Assert.Contains("\"durationSeconds\": 0.6333333333333333", clipJson);
    }

    [Fact]
    public async Task DeleteClipRemovesClipFilesAndUpdatesCharacterManifest()
    {
        await using var factory = CreateFactory();
        var client = factory.CreateClient();
        await client.PostAsync("/api/v1/workspaces/browser", content: null);

        using var characterForm = new MultipartFormDataContent();
        characterForm.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("fake fbx bytes")), "visual", "IyoMixamo.fbx");

        var characterResponse = await client.PostAsync("/api/v1/workspaces/browser/characters", characterForm);
        characterResponse.EnsureSuccessStatusCode();
        using var characterJson = JsonDocument.Parse(await characterResponse.Content.ReadAsStringAsync());
        var characterId = characterJson.RootElement.GetProperty("id").GetString();

        using var clipForm = new MultipartFormDataContent();
        clipForm.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("HIERARCHY\nROOT Hips\nMOTION\nFrames: 42\nFrame Time: 0.0333333\n")), "clip", "RunForward.bvh");

        var clipResponse = await client.PostAsync($"/api/v1/workspaces/browser/characters/{characterId}/clips", clipForm);
        clipResponse.EnsureSuccessStatusCode();
        using var clipJson = JsonDocument.Parse(await clipResponse.Content.ReadAsStringAsync());
        var clipId = clipJson.RootElement.GetProperty("clips")[0].GetProperty("id").GetString();

        var deleteResponse = await client.DeleteAsync($"/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}");
        var deleteJson = await deleteResponse.Content.ReadAsStringAsync();

        deleteResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"clips\":[]", deleteJson);
        Assert.False(Directory.Exists(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Clips", "RunForward")));

        var characterManifestJson = await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "character.json"));
        Assert.DoesNotContain("\"Clips/RunForward/clip.json\"", characterManifestJson);
    }

    [Fact]
    public async Task UploadVisualFbxRejectsConfiguredSizeLimit()
    {
        await using var factory = CreateFactory(("Studio:MaxUploadBytes", "8"));
        var client = factory.CreateClient();
        await client.PostAsync("/api/v1/workspaces/browser", content: null);

        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("too many bytes")), "visual", "TooBig.fbx");

        var response = await client.PostAsync("/api/v1/workspaces/browser/characters", form);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    private WebApplicationFactory<Program> CreateFactory(params (string Key, string Value)[] overrides)
    {
        return new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSolutionRelativeContentRoot("src/MotionMatching.Studio.Backend");
                builder.ConfigureAppConfiguration((_, configuration) =>
                {
                    var values = new Dictionary<string, string?>
                    {
                        ["Studio:WorkspaceRoot"] = _workspaceRoot
                    };

                    foreach (var (key, value) in overrides)
                    {
                        values[key] = value;
                    }

                    configuration.AddInMemoryCollection(values);
                });
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<IClipTimelineExtractor>();
                    services.AddSingleton<IClipTimelineExtractor, FakeClipTimelineExtractor>();
                    services.RemoveAll<ISkeletonNameExtractor>();
                    services.AddSingleton<ISkeletonNameExtractor, FakeSkeletonNameExtractor>();
                });
            });
    }

    private sealed class FakeClipTimelineExtractor : IClipTimelineExtractor
    {
        public Task<ClipTimelineMetadata?> ExtractAsync(string assetPath, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<ClipTimelineMetadata?>(new ClipTimelineMetadata(20, 30, 0.6333333333333333));
        }
    }

    private sealed class FakeSkeletonNameExtractor : ISkeletonNameExtractor
    {
        public Task<SkeletonNameExtractionResult> ExtractAsync(
            string assetPath,
            ClipSourceKind sourceKind,
            CancellationToken cancellationToken = default)
        {
            var names = assetPath.Contains($"{Path.DirectorySeparatorChar}Visual{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)
                ? new[] { "Hips", "Spine", "Head", "LeftUpLeg", "RightUpLeg" }
                : new[] { "Hips", "Spine", "Head", "LeftUpLeg", "RightUpLeg" };

            return Task.FromResult(SkeletonNameExtractionResult.Success(names));
        }
    }
}
