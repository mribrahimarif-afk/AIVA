import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/infrastructure/db/client";
import { GET } from "@/app/api/projects/[id]/director/route";
import { POST } from "@/app/api/projects/[id]/director/analyze/route";
import { services, directorAiProvider } from "@/services/container";
import { FakeDirectorProvider } from "tests/mocks/fake-director.provider";

describe("Director API Routes Integration Tests", () => {
  let projectId: string;

  beforeEach(async () => {
    await prisma.directorScene.deleteMany();
    await prisma.directorPlan.deleteMany();
    await prisma.scene.deleteMany();
    await prisma.project.deleteMany();

    const project = await prisma.project.create({
      data: {
        name: "Test API Commercial",
        script: "Initial script for testing.",
      },
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await prisma.directorScene.deleteMany();
    await prisma.directorPlan.deleteMany();
    await prisma.scene.deleteMany();
    await prisma.project.deleteMany();
    vi.restoreAllMocks();
  });

  it("GET /api/projects/[id]/director returns null plan when none exists", async () => {
    const response = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: projectId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.plan).toBeNull();
    expect(typeof body.isAiConfigured).toBe("boolean");
  });

  it("POST /api/projects/[id]/director/analyze rejects empty script with 400 ValidationError", async () => {
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: "   " }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.name).toBe("ValidationError");
  });

  it("POST /api/projects/[id]/director/analyze rejects invalid JSON with 400 ValidationError", async () => {
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid-json{",
      }),
      { params: Promise.resolve({ id: projectId }) }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.name).toBe("ValidationError");
  });

  it("POST /api/projects/[id]/director/analyze returns 404 if project does not exist", async () => {
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: "Valid script text here." }),
      }),
      { params: Promise.resolve({ id: "non-existent-project-id" }) }
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.name).toBe("NotFoundError");
  });

  it("POST /api/projects/[id]/director/analyze generates and persists plan with mocked provider", async () => {
    const fakeProvider = new FakeDirectorProvider();
    vi.spyOn(directorAiProvider, "isConfigured").mockReturnValue(true);
    vi.spyOn(directorAiProvider, "analyze").mockImplementation((input) =>
      fakeProvider.analyze(input)
    );

    const scriptText = "Discover pure energy. Built for athletes everywhere.";
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptText }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.plan).toBeDefined();
    expect(body.plan.originalScript).toBe(scriptText);
    expect(body.plan.scenes.length).toBeGreaterThanOrEqual(1);

    // Verify GET now returns the persisted plan
    const getResponse = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: projectId }),
    });
    const getBody = await getResponse.json();
    expect(getBody.plan).not.toBeNull();
    expect(getBody.plan.originalScript).toBe(scriptText);
  });

  it("POST /api/projects/[id]/director/analyze preserves exact script with leading/trailing whitespace, tabs, CRLF, and Urdu without trimming", async () => {
    const fakeProvider = new FakeDirectorProvider();
    vi.spyOn(directorAiProvider, "isConfigured").mockReturnValue(true);
    vi.spyOn(directorAiProvider, "analyze").mockImplementation((input) =>
      fakeProvider.analyze(input)
    );

    const complexScript =
      "  \t\r\nPehela scene Roman Urdu mein shuru hota hai.\r\n\r\nیہ دوسرا سین اردو رسم الخط میں ہے۔ ✨\n\tFinal scene with trailing spaces and tabs.\t  \r\n";

    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: complexScript }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const plan = body.plan;

    // 1. Persisted originalScript is byte-for-byte equal to input
    expect(plan.originalScript).toBe(complexScript);
    expect(plan.originalScript.length).toBe(complexScript.length);

    // 2. Reconstructed scene narration equals exact input
    const fullNarration = plan.scenes.map((s: { text: string }) => s.text).join("");
    expect(fullNarration).toBe(complexScript);

    // 3. Project.script receives exact input
    const projectInDb = await prisma.project.findUnique({ where: { id: projectId } });
    expect(projectInDb?.script).toBe(complexScript);

    // 4. SHA-256 is calculated from exact input
    const { createHash } = await import("crypto");
    const expectedHash = createHash("sha256").update(complexScript, "utf8").digest("hex");
    expect(plan.scriptHash).toBe(expectedHash);
  });
});
