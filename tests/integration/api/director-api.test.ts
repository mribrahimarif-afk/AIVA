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
});
