using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MotionMatching.PreviewRuntime;

public static class GlbTextureStripper
{
    private const uint GlbMagic = 0x46546C67;
    private const uint JsonChunkType = 0x4E4F534A;

    public static void StripExternalTextureReferences(string glbPath)
    {
        var bytes = File.ReadAllBytes(glbPath);
        if (bytes.Length < 20 || ReadUInt32(bytes, 0) != GlbMagic)
        {
            return;
        }

        var jsonLength = checked((int)ReadUInt32(bytes, 12));
        var jsonType = ReadUInt32(bytes, 16);
        if (jsonType != JsonChunkType || bytes.Length < 20 + jsonLength)
        {
            return;
        }

        var jsonText = Encoding.UTF8.GetString(bytes, 20, jsonLength).TrimEnd('\0', ' ', '\n', '\r', '\t');
        var root = JsonNode.Parse(jsonText)?.AsObject();
        if (root is null)
        {
            return;
        }

        root.Remove("images");
        root.Remove("textures");
        root.Remove("samplers");
        StripMaterialTextureSlots(root);

        var updatedJson = JsonSerializer.Serialize(root, new JsonSerializerOptions
        {
            WriteIndented = false
        });

        var updatedJsonBytes = PadToFourBytes(Encoding.UTF8.GetBytes(updatedJson), (byte)' ');
        var remainingChunksOffset = 20 + jsonLength;
        var remainingLength = bytes.Length - remainingChunksOffset;
        var totalLength = 12 + 8 + updatedJsonBytes.Length + remainingLength;

        var output = new byte[totalLength];
        WriteUInt32(output, 0, GlbMagic);
        WriteUInt32(output, 4, ReadUInt32(bytes, 4));
        WriteUInt32(output, 8, (uint)totalLength);
        WriteUInt32(output, 12, (uint)updatedJsonBytes.Length);
        WriteUInt32(output, 16, JsonChunkType);
        updatedJsonBytes.CopyTo(output.AsSpan(20));
        bytes.AsSpan(remainingChunksOffset).CopyTo(output.AsSpan(20 + updatedJsonBytes.Length));

        File.WriteAllBytes(glbPath, output);
    }

    private static void StripMaterialTextureSlots(JsonObject root)
    {
        if (root["materials"] is not JsonArray materials)
        {
            return;
        }

        foreach (var materialNode in materials)
        {
            if (materialNode is not JsonObject material)
            {
                continue;
            }

            RemoveTextureInfo(material, "normalTexture");
            RemoveTextureInfo(material, "occlusionTexture");
            RemoveTextureInfo(material, "emissiveTexture");

            if (material["pbrMetallicRoughness"] is JsonObject pbr)
            {
                RemoveTextureInfo(pbr, "baseColorTexture");
                RemoveTextureInfo(pbr, "metallicRoughnessTexture");
            }
        }
    }

    private static void RemoveTextureInfo(JsonObject owner, string propertyName)
    {
        owner.Remove(propertyName);
    }

    private static byte[] PadToFourBytes(byte[] bytes, byte pad)
    {
        var paddedLength = (bytes.Length + 3) & ~3;
        if (paddedLength == bytes.Length)
        {
            return bytes;
        }

        var padded = new byte[paddedLength];
        bytes.CopyTo(padded, 0);
        Array.Fill(padded, pad, bytes.Length, padded.Length - bytes.Length);
        return padded;
    }

    private static uint ReadUInt32(byte[] bytes, int offset)
    {
        return BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset, 4));
    }

    private static void WriteUInt32(byte[] bytes, int offset, uint value)
    {
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset, 4), value);
    }
}
