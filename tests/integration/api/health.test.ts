import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("reports overall, database, storage, and ffmpeg state", async () => {
    const response = await GET();
    const body = (await response.json()) as {
      status: string;
      database: { state: string };
      storage: { state: string; root: string };
      ffmpeg: { state: string; available: boolean };
    };

    expect(["OK", "DEGRADED", "DOWN"]).toContain(body.status);
    expect(body.database.state).toBe("OK");
    expect(body.storage.state).toBe("OK");
    expect(typeof body.storage.root).toBe("string");
    expect(["OK", "DEGRADED"]).toContain(body.ffmpeg.state);
  });

  it("degrades rather than crashes when FFmpeg is unavailable", async () => {
    const response = await GET();
    const body = (await response.json()) as { status: string; ffmpeg: { available: boolean; state: string } };

    if (!body.ffmpeg.available) {
      expect(body.ffmpeg.state).toBe("DEGRADED");
      expect(body.status).not.toBe("DOWN");
      expect(response.status).not.toBe(503);
    }
  });

  it("returns HTTP 200 when overall status is not DOWN", async () => {
    const response = await GET();
    const body = (await response.json()) as { status: string };
    if (body.status !== "DOWN") {
      expect(response.status).toBe(200);
    }
  });
});
