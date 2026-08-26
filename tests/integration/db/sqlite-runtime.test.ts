import { describe, it, expect } from "vitest";
import { prisma } from "@/infrastructure/db/client";

describe("SQLite Local Runtime & Database Open Verification", () => {
  it("opens the SQLite database without Error code 14", async () => {
    // Perform basic queries to confirm connection and table availability
    const brandCount = await prisma.brand.count();
    expect(typeof brandCount).toBe("number");

    const projectCount = await prisma.project.count();
    expect(typeof projectCount).toBe("number");
  });

  it("can execute brand and project queries successfully", async () => {
    const brand = await prisma.brand.create({
      data: { name: "Test Startup Brand", slug: "test-startup-brand" },
    });
    expect(brand.id).toBeDefined();

    const fetched = await prisma.brand.findUnique({ where: { id: brand.id } });
    expect(fetched?.name).toBe("Test Startup Brand");

    await prisma.brand.delete({ where: { id: brand.id } });
  });
});
