using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace MotionMatching.Authoring;

public readonly partial record struct StudioId
{
    private static readonly Regex KnownIdPattern = KnownIdRegex();

    public StudioId(string value)
    {
        if (!KnownIdPattern.IsMatch(value))
        {
            throw new ArgumentException("Studio IDs must use the shape prefix_12hex.", nameof(value));
        }

        Value = value;
    }

    public string Value { get; }

    public static StudioId New(string prefix)
    {
        if (!Regex.IsMatch(prefix, "^[a-z]{3}$"))
        {
            throw new ArgumentException("Studio ID prefixes must be exactly three lowercase letters.", nameof(prefix));
        }

        return new StudioId($"{prefix}_{RandomNumberGenerator.GetHexString(12, lowercase: true)}");
    }

    public static StudioId FromKnown(string value)
    {
        return new StudioId(value);
    }

    public override string ToString()
    {
        return Value;
    }

    [GeneratedRegex("^[a-z]{3}_[a-f0-9]{12}$", RegexOptions.CultureInvariant)]
    private static partial Regex KnownIdRegex();
}
