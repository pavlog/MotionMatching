using System.Text.Json;
using System.Text.Json.Serialization;

namespace MotionMatching.Authoring;

public sealed class StudioIdJsonConverter : JsonConverter<StudioId>
{
    public override StudioId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        return StudioId.FromKnown(reader.GetString() ?? throw new JsonException("Studio ID cannot be null."));
    }

    public override void Write(Utf8JsonWriter writer, StudioId value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.Value);
    }
}
