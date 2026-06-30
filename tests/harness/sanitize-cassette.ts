export interface CassetteSanitizationFinding {
  rule: string;
  match: string;
  index: number;
}

const forbiddenPatterns: readonly {
  rule: string;
  pattern: RegExp;
  allow?: (match: string) => boolean;
}[] = [
  {
    rule: "live secret name",
    pattern:
      /CLINICCARDS_TOKEN|SMS_PROVIDER_API_KEY|TOKEN_PEPPER|PHONE_PEPPER/gu,
  },
  {
    rule: "raw token URL",
    pattern: /https:\/\/r\.dentino\.com\.ua\/r\/[A-Za-z0-9_-]{20,128}/gu,
  },
  {
    rule: "patient-looking Ukrainian mobile",
    pattern:
      /\b380(39|50|63|66|67|68|73|91|92|93|94|95|96|97|98|99)[0-9]{7}\b/gu,
    allow: (match) => match === "380000000000",
  },
];

export function auditCassetteText(
  text: string,
): CassetteSanitizationFinding[] {
  const findings: CassetteSanitizationFinding[] = [];

  for (const { rule, pattern, allow } of forbiddenPatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (allow?.(value)) {
        continue;
      }
      findings.push({
        rule,
        match: value,
        index: match.index ?? -1,
      });
    }
  }

  return findings;
}

export function assertCassetteSanitized(text: string): void {
  const findings = auditCassetteText(text);
  if (findings.length > 0) {
    const details = findings
      .map((finding) => `${finding.rule} at ${finding.index}`)
      .join("; ");
    throw new Error(`Cassette sanitization failed: ${details}`);
  }
}
