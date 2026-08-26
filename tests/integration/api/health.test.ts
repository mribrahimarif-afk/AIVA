import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("reports storage as DOWN (not OK) when the storage root exists but isn't writable", async () => {
    // The directory tree already exists at this point (earlier tests /
    // app startup created it), so this simulates a storage root that
    // *exists* but has since become read-only — mkdir(recursive: true)
    // alone wouldn't catch this; only the write probe does.
    const spy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValue(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));

    try {
      const response = await GET();
      const body = (await response.json()) as {
        status: string;
        storage: { state: string };
      };

      expect(body.storage.state).toBe("DOWN");
      expect(body.status).toBe("DOWN");
      expect(response.status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
