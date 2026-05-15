using System.Text.Json;
using System.Text.Json.Serialization;

namespace MotionMatching.Authoring;

public static class ManifestJson
{
    public static readonly JsonSerializerOptions Options = CreateOptions();

    public static string Serialize<T>(T value)
    {
        return JsonSerializer.Serialize(value, Options) + Environment.NewLine;
    }

    public static T Deserialize<T>(string json)
    {
        return JsonSerializer.Deserialize<T>(json, Options)
            ?? throw new JsonException($"Could not deserialize {typeof(T).Name}.");
    }

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };

        options.Converters.Add(new StudioIdJsonConverter());
        options.Converters.Add(new JsonStringEnumConverter<WorkspaceMode>(JsonNamingPolicy.SnakeCaseLower));
        options.Converters.Add(new JsonStringEnumConverter<ClipSourceKind>(JsonNamingPolicy.SnakeCaseLower));
        return options;
    }
}
