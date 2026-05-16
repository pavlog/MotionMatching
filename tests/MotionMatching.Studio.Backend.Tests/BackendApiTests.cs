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
    public async Task DeleteCharacterRemovesCharacterFilesAndWorkspaceReference()
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

        var deleteResponse = await client.DeleteAsync($"/api/v1/workspaces/browser/characters/{characterId}");
        var deleteJson = await deleteResponse.Content.ReadAsStringAsync();

        deleteResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"characters\":[]", deleteJson);
        Assert.False(Directory.Exists(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo")));

        var workspaceJson = await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "workspace.json"));
        Assert.DoesNotContain("IyoMixamo", workspaceJson);
    }

    [Fact]
    public async Task UpdateClipSettingsPersistsRoleTagsAndBuildInclusion()
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

        var settingsResponse = await client.PatchAsJsonAsync(
            $"/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}/settings",
            new
            {
                includeInBuild = false,
                mirrorInBuild = true,
                clipRole = "run_stop",
                contactDetectionPreset = "strict",
                tags = new[] { "Run", "Loop", "custom tag" }
            });
        var settingsJson = await settingsResponse.Content.ReadAsStringAsync();

        settingsResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"includeInBuild\":false", settingsJson);
        Assert.Contains("\"mirrorInBuild\":true", settingsJson);
        Assert.Contains("\"clipRole\":null", settingsJson);
        Assert.Contains("\"contactDetectionPreset\":\"strict\"", settingsJson);
        Assert.Contains("\"tags\":[\"custom_tag\",\"loop\",\"run\"]", settingsJson);

        var persistedClipJson = await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Clips", "RunForward", "clip.json"));
        Assert.Contains("\"includeInBuild\": false", persistedClipJson);
        Assert.Contains("\"mirrorInBuild\": true", persistedClipJson);
        Assert.DoesNotContain("\"clipRole\"", persistedClipJson);
        Assert.Contains("\"contactDetectionPreset\": \"strict\"", persistedClipJson);
        Assert.Contains("\"custom_tag\"", persistedClipJson);
        Assert.DoesNotContain(_workspaceRoot, persistedClipJson);

        using var replacementForm = new MultipartFormDataContent();
        replacementForm.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("HIERARCHY\nROOT Hips\nMOTION\nFrames: 12\nFrame Time: 0.0416667\n")), "clip", "StopForward.bvh");

        var replacementResponse = await client.PostAsync($"/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}/replace-source", replacementForm);
        var replacementJson = await replacementResponse.Content.ReadAsStringAsync();

        replacementResponse.EnsureSuccessStatusCode();
        Assert.Contains($"\"id\":\"{clipId}\"", replacementJson);
        Assert.Contains("\"sourceFileName\":\"StopForward.bvh\"", replacementJson);
        Assert.Contains("\"includeInBuild\":false", replacementJson);
        Assert.Contains("\"mirrorInBuild\":true", replacementJson);
        Assert.Contains("\"clipRole\":null", replacementJson);
        Assert.Contains("\"contactDetectionPreset\":\"strict\"", replacementJson);

        persistedClipJson = await File.ReadAllTextAsync(Path.Combine(_workspaceRoot, "Characters", "IyoMixamo", "Clips", "RunForward", "clip.json"));
        Assert.Contains("\"sourceFileName\": \"StopForward.bvh\"", persistedClipJson);
        Assert.Contains("\"frameCount\": 12", persistedClipJson);
        Assert.Contains("\"includeInBuild\": false", persistedClipJson);
        Assert.Contains("\"mirrorInBuild\": true", persistedClipJson);
    }

    [Fact]
    public async Task CharacterResponseIncludesBuildReadinessPlan()
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

        var settingsResponse = await client.PatchAsJsonAsync(
            $"/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}/settings",
            new
            {
                includeInBuild = true,
                mirrorInBuild = true,
                clipRole = "run_loop",
                contactDetectionPreset = "auto",
                tags = Array.Empty<string>()
            });
        var settingsJson = await settingsResponse.Content.ReadAsStringAsync();

        settingsResponse.EnsureSuccessStatusCode();
        using var responseJson = JsonDocument.Parse(settingsJson);
        var readiness = responseJson.RootElement.GetProperty("buildReadiness");

        Assert.Equal(1, readiness.GetProperty("includedClipCount").GetInt32());
        Assert.Equal(1, readiness.GetProperty("mirroredCopyCount").GetInt32());
        Assert.Equal(2, readiness.GetProperty("plannedClipCount").GetInt32());
        Assert.Contains(readiness.GetProperty("planEntries").EnumerateArray(), entry =>
            entry.GetProperty("clipName").GetString() == "RunForward Mirror" &&
            entry.GetProperty("isMirrored").GetBoolean());
        Assert.Contains(readiness.GetProperty("roles").EnumerateArray(), role =>
            role.GetProperty("role").GetString() == "run_loop" &&
            role.GetProperty("includedClipCount").GetInt32() == 1);
        Assert.Contains(readiness.GetProperty("skeletonCoverage").EnumerateArray(), item =>
            item.GetProperty("clipName").GetString() == "RunForward" &&
            item.GetProperty("status").GetString() == "ok");
        Assert.Contains(readiness.GetProperty("footContacts").EnumerateArray(), item =>
            item.GetProperty("clipName").GetString() == "RunForward" &&
            item.GetProperty("hasContacts").GetBoolean() == false);
    }

    [Fact]
    public async Task GenerateBuildReportWritesPortableReport()
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

        var settingsResponse = await client.PatchAsJsonAsync(
            $"/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}/settings",
            new
            {
                includeInBuild = true,
                mirrorInBuild = true,
                clipRole = "run_loop",
                contactDetectionPreset = "auto",
                tags = Array.Empty<string>()
            });
        settingsResponse.EnsureSuccessStatusCode();

        var reportResponse = await client.PostAsync($"/api/v1/workspaces/browser/characters/{characterId}/build-report", content: null);
        var reportJson = await reportResponse.Content.ReadAsStringAsync();

        reportResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"reportPath\":\"Builds/IyoMixamo/build-report.json\"", reportJson);
        Assert.Contains("\"readinessFingerprint\":", reportJson);
        Assert.Contains("\"plannedClipCount\":2", reportJson);

        var readReportResponse = await client.GetAsync($"/api/v1/workspaces/browser/characters/{characterId}/build-report");
        var readReportJson = await readReportResponse.Content.ReadAsStringAsync();

        readReportResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"reportPath\":\"Builds/IyoMixamo/build-report.json\"", readReportJson);
        Assert.Contains("\"plannedClipCount\":2", readReportJson);

        var workspaceResponse = await client.GetAsync("/api/v1/workspaces/browser");
        var workspaceJson = await workspaceResponse.Content.ReadAsStringAsync();

        workspaceResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"buildReportPath\":\"Builds/IyoMixamo/build-report.json\"", workspaceJson);
        Assert.Contains("\"buildReportStatus\":\"current\"", workspaceJson);

        var updateResponse = await client.PatchAsJsonAsync(
            $"/api/v1/workspaces/browser/characters/{characterId}/clips/{clipId}/settings",
            new
            {
                includeInBuild = true,
                mirrorInBuild = false,
                clipRole = "run_loop",
                contactDetectionPreset = "auto",
                tags = Array.Empty<string>()
            });
        updateResponse.EnsureSuccessStatusCode();

        workspaceResponse = await client.GetAsync("/api/v1/workspaces/browser");
        workspaceJson = await workspaceResponse.Content.ReadAsStringAsync();

        workspaceResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"buildReportStatus\":\"outdated\"", workspaceJson);

        var reportPath = Path.Combine(_workspaceRoot, "Builds", "IyoMixamo", "build-report.json");
        Assert.True(File.Exists(reportPath));

        var persistedReportJson = await File.ReadAllTextAsync(reportPath);
        Assert.Contains("\"characterName\": \"IyoMixamo\"", persistedReportJson);
        Assert.Contains("\"reportPath\": \"Builds/IyoMixamo/build-report.json\"", persistedReportJson);
        Assert.Contains("\"plannedClipCount\": 2", persistedReportJson);
        Assert.DoesNotContain(_workspaceRoot, persistedReportJson);
        Assert.DoesNotContain(Path.GetTempPath(), persistedReportJson);
    }

    [Fact]
    public async Task GenerateRuntimeBuildDraftWritesDraftArtifactPlan()
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

        var settingsResponse = await client.PatchAsJsonAsync(
            $"/api/v1/workspaces/browser/characters/{characterId}/runtime-build-settings",
            new { sampleFrameStep = 2, scaleMode = "source_x0_01" });
        settingsResponse.EnsureSuccessStatusCode();

        var draftResponse = await client.PostAsync($"/api/v1/workspaces/browser/characters/{characterId}/runtime-build-draft", content: null);
        var draftJson = await draftResponse.Content.ReadAsStringAsync();

        draftResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"draftPath\":\"Builds/IyoMixamo/runtime-build-draft.json\"", draftJson);
        Assert.Contains("\"sampleFrameStep\":2", draftJson);
        Assert.Contains("\"sourceReportPath\":\"Builds/IyoMixamo/build-report.json\"", draftJson);
        Assert.Contains("\"fileName\":\"IyoMixamo.mmskeleton\"", draftJson);
        Assert.Contains("\"status\":\"draft\"", draftJson);
        Assert.Contains("\"boneCount\":5", draftJson);
        Assert.Contains("\"boneNames\":[\"Hips\",\"Spine\",\"Head\",\"LeftUpLeg\",\"RightUpLeg\"]", draftJson);
        Assert.Contains("\"fileName\":\"IyoMixamo.mmpose\"", draftJson);
        Assert.Contains("\"fileName\":\"IyoMixamo.mmfeatures\"", draftJson);
        Assert.Contains("\"fileName\":\"IyoMixamo.mmdatabase\"", draftJson);
        Assert.Contains("\"plannedPoseSampleCount\":21", draftJson);
        Assert.Contains("\"samples\"", draftJson);
        Assert.Contains("\"featureCount\":7", draftJson);
        Assert.Contains("\"schema\":{\"id\":\"motionstudio.runtime-database\",\"version\":0", draftJson);
        Assert.Contains("\"schemaVersion\":\"motionstudio.runtime-database-draft.v0\"", draftJson);
        Assert.Contains("\"sampleCount\":21", draftJson);
        Assert.Contains("\"name\":\"trajectory_position\"", draftJson);
        Assert.Contains("\"scale\"", draftJson);
        Assert.Contains("\"mode\":\"source_x0_01\"", draftJson);
        Assert.Contains("\"trajectory_position_20\"", draftJson);
        Assert.Contains("\"samplePreviews\"", draftJson);

        var draftPath = Path.Combine(_workspaceRoot, "Builds", "IyoMixamo", "runtime-build-draft.json");
        var skeletonPath = Path.Combine(_workspaceRoot, "Builds", "IyoMixamo", "IyoMixamo.mmskeleton");
        var posePath = Path.Combine(_workspaceRoot, "Builds", "IyoMixamo", "IyoMixamo.mmpose");
        var featurePath = Path.Combine(_workspaceRoot, "Builds", "IyoMixamo", "IyoMixamo.mmfeatures");
        var databasePath = Path.Combine(_workspaceRoot, "Builds", "IyoMixamo", "IyoMixamo.mmdatabase");
        Assert.True(File.Exists(draftPath));
        Assert.True(File.Exists(skeletonPath));
        Assert.True(File.Exists(posePath));
        Assert.True(File.Exists(featurePath));
        Assert.True(File.Exists(databasePath));

        var persistedDraftJson = await File.ReadAllTextAsync(draftPath);
        Assert.Contains("\"trajectory_position[20,40,60]:simulation_bone\"", persistedDraftJson);
        Assert.Contains("\"status\": \"draft\"", persistedDraftJson);
        Assert.DoesNotContain(_workspaceRoot, persistedDraftJson);
        Assert.DoesNotContain(Path.GetTempPath(), persistedDraftJson);
        var persistedSkeletonJson = await File.ReadAllTextAsync(skeletonPath);
        Assert.Contains("\"rootBoneName\": \"Hips\"", persistedSkeletonJson);
        Assert.Contains("\"slot\": \"hips\"", persistedSkeletonJson);
        Assert.DoesNotContain(_workspaceRoot, persistedSkeletonJson);
        Assert.DoesNotContain(Path.GetTempPath(), persistedSkeletonJson);
        var persistedPoseJson = await File.ReadAllTextAsync(posePath);
        Assert.Contains("\"clipName\": \"RunForward\"", persistedPoseJson);
        Assert.Contains("\"plannedSampleCount\": 21", persistedPoseJson);
        Assert.Contains("\"sampleFramesPreview\": [", persistedPoseJson);
        Assert.Contains("\"samples\":", persistedPoseJson);
        Assert.DoesNotContain(_workspaceRoot, persistedPoseJson);
        Assert.DoesNotContain(Path.GetTempPath(), persistedPoseJson);
        var persistedFeatureJson = await File.ReadAllTextAsync(featurePath);
        Assert.Contains("\"featureCount\": 7", persistedFeatureJson);
        Assert.Contains("\"boneSlot\": \"simulation_bone\"", persistedFeatureJson);
        Assert.Contains("\"sampleFrameStep\": 2", persistedFeatureJson);
        Assert.Contains("\"normalizationFactor\": 0.01", persistedFeatureJson);
        Assert.Contains("\"values\": {", persistedFeatureJson);
        Assert.Contains("\"trajectory_direction_60\"", persistedFeatureJson);
        Assert.DoesNotContain(_workspaceRoot, persistedFeatureJson);
        Assert.DoesNotContain(Path.GetTempPath(), persistedFeatureJson);
        var persistedDatabaseJson = await File.ReadAllTextAsync(databasePath);
        Assert.Contains("\"schemaVersion\": \"motionstudio.runtime-database-draft.v0\"", persistedDatabaseJson);
        Assert.Contains("\"id\": \"motionstudio.runtime-database\"", persistedDatabaseJson);
        Assert.Contains("\"clipName\": \"RunForward\"", persistedDatabaseJson);
        Assert.Contains("\"samples\": [", persistedDatabaseJson);
        Assert.Contains("\"frame\": 40", persistedDatabaseJson);
        Assert.Contains("\"features\": {", persistedDatabaseJson);
        Assert.DoesNotContain(_workspaceRoot, persistedDatabaseJson);
        Assert.DoesNotContain(Path.GetTempPath(), persistedDatabaseJson);
        Assert.True(File.Exists(Path.Combine(_workspaceRoot, "Builds", "IyoMixamo", "build-report.json")));

        var workspaceResponse = await client.GetAsync("/api/v1/workspaces/browser");
        var workspaceJson = await workspaceResponse.Content.ReadAsStringAsync();
        workspaceResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"runtimeBuildDraftPath\":\"Builds/IyoMixamo/runtime-build-draft.json\"", workspaceJson);
        Assert.Contains("\"runtimeBuildDraftStatus\":\"current\"", workspaceJson);
        Assert.Contains("\"runtimeBuildSettings\":{\"sampleFrameStep\":2,\"scaleMode\":\"source_x0_01\"}", workspaceJson);

        var loadedDraftResponse = await client.GetAsync($"/api/v1/workspaces/browser/characters/{characterId}/runtime-build-draft");
        var loadedDraftJson = await loadedDraftResponse.Content.ReadAsStringAsync();
        loadedDraftResponse.EnsureSuccessStatusCode();
        Assert.Contains("\"draftPath\":\"Builds/IyoMixamo/runtime-build-draft.json\"", loadedDraftJson);
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
