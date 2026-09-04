// owns: R7 · shared — how a verdict is shown to the writer that must answer it. The
// authority of each finding is stated in its own line: certain is a literal
// observation to fix or refute; likely is a judgement call to address or stand
// against. Deferrals are shown as what they are — not this round's work.

export function renderFindingsForAgent(verdict) {
  if (!verdict) return null;
  const findings = verdict.findings ?? [];
  const deferred = verdict.deferred ?? [];
  if (!findings.length && !deferred.length) return null;

  const parts = [];
  if (findings.length) {
    const lines = findings.map((f, i) => {
      const authority = f.confidence === "certain"
        ? "CERTAIN — a literal observation. Fix it, or show the observation itself is wrong."
        : "LIKELY — a judgement call. Address it, or say plainly why it stands.";
      return [
        `${i + 1}. [${f.severity}/${f.confidence}] ${f.rule} — ${f.subject}`,
        `   ${f.summary}`,
        f.evidence ? `   evidence: ${f.evidence}` : null,
        f.remedy ? `   suggested: ${f.remedy}` : null,
        `   ${authority}`,
      ].filter(Boolean).join("\n");
    });
    parts.push(
      `The ${verdict.gate} gate returned ${verdict.verdict.toUpperCase()} on the previous version of this work, over ${verdict.checked ?? "?"} item(s). These findings are why it is being redone:\n\n${lines.join("\n\n")}`,
    );
  }
  if (deferred.length) {
    parts.push(
      `Deferred — noticed, beyond the line, not this round's work. Do not address these:\n\n` +
        deferred.map((d, i) => `${i + 1}. ${d.subject} — ${d.summary} (beyond: ${d.beyond})`).join("\n"),
    );
  }
  return parts.join("\n\n");
}
