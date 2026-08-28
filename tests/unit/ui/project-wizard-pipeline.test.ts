import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/projects/project-creation-wizard.tsx", "utf8");

describe("Project wizard TASK-005 pipeline wiring", () => {
  it("Via Script generates once, then uploads/transcribes narration, then builds Timeline", () => {
    const scriptBranch = source.slice(source.indexOf('if (mode === "SCRIPT")'), source.indexOf("} else {", source.indexOf('if (mode === "SCRIPT")')));
    expect(scriptBranch.match(/\/voice\/generate/g)).toHaveLength(1);
    expect(scriptBranch.indexOf("/voice/generate")).toBeLessThan(scriptBranch.indexOf("/voice/audio"));
    expect(scriptBranch.indexOf("/voice/audio")).toBeLessThan(scriptBranch.indexOf("/transcription"));
    expect(scriptBranch.indexOf("/transcription")).toBeLessThan(scriptBranch.indexOf("/timeline"));
  });

  it("Via Voice builds Timeline after Director and makes zero TTS calls", () => {
    const voiceBranchStart = source.indexOf("} else {", source.indexOf('if (mode === "SCRIPT")'));
    const voiceBranch = source.slice(voiceBranchStart, source.indexOf("router.push", voiceBranchStart));
    expect(voiceBranch).not.toContain("/voice/generate");
    expect(voiceBranch.indexOf("use-with-director")).toBeLessThan(voiceBranch.indexOf("/timeline"));
  });
});
