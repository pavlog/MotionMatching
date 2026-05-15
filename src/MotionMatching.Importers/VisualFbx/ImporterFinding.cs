namespace MotionMatching.Importers;

public enum ImporterFindingSeverity
{
    Info,
    Warning,
    Error
}

public sealed record ImporterFinding(
    string Code,
    ImporterFindingSeverity Severity,
    string Message);
