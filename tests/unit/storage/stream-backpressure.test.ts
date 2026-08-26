import { describe, it, expect, afterEach } from "vitest";
import { Readable, Writable } from "node:stream";
import { storageService } from "@/storage/storage.service";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { ValidationError } from "@/domain/errors";
import { resetEnvCache } from "@/infrastructure/config/env";

describe("Storage Stream Backpressure & Max Bytes Enforcement", () => {
  let tempFilesCreated: string[] = [];

  afterEach(async () => {
    resetEnvCache();
    for (const f of tempFilesCreated) {
      await fs.rm(f, { force: true });
    }
    tempFilesCreated = [];
  });

  it("handles backpressure drain event when custom Writable returns false on write", async () => {
    const chunk1 = Buffer.from("CHUNK_001_BACKPRESSURE_A_");
    const chunk2 = Buffer.from("CHUNK_002_BACKPRESSURE_B_");
    const fullPayload = Buffer.concat([chunk1, chunk2]);

    let drainEmitted = false;
    let writtenBytes = 0;

    const backpressureWritable = new Writable({
      highWaterMark: 5,
      write(chunk, encoding, callback) {
        writtenBytes += chunk.length;
        setImmediate(() => {
          callback();
        });
      },
    });

    backpressureWritable.on("drain", () => {
      drainEmitted = true;
    });

    const canWrite1 = backpressureWritable.write(chunk1);
    expect(canWrite1).toBe(false);

    await new Promise<void>((resolve) => {
      backpressureWritable.once("drain", () => {
        resolve();
      });
    });

    expect(drainEmitted).toBe(true);
    expect(writtenBytes).toBe(chunk1.length);

    // Also verify stageStream handles multi-chunk stream cleanly
    const nodeStream = Readable.from([chunk1, chunk2]);
    const staged = await storageService.stageStream(nodeStream, "backpressure_test.txt");
    tempFilesCreated.push(staged.tempPath);

    expect(staged.sizeBytes).toBe(fullPayload.length);
    const expectedHash = crypto.createHash("sha256").update(fullPayload).digest("hex");
    expect(staged.checksum).toBe(expectedHash);
  });

  it("enforces chunk-by-chunk AIVA_MAX_UPLOAD_BYTES limit on stream, throws ValidationError and cleans temp file", async () => {
    const originalMax = process.env.AIVA_MAX_UPLOAD_BYTES;
    try {
      // Configure small max upload bytes limit of 100 bytes and reset cached env
      process.env.AIVA_MAX_UPLOAD_BYTES = "100";
      resetEnvCache();

      const oversizedPayload = Buffer.alloc(150, "X"); // 150 bytes exceeds 100 bytes limit
      const nodeStream = Readable.from([oversizedPayload]);

      let thrownErr: unknown = null;
      let stagedTempPath: string | null = null;

      try {
        const staged = await storageService.stageStream(nodeStream, "oversized.bin");
        stagedTempPath = staged.tempPath;
      } catch (err) {
        thrownErr = err;
      }

      expect(thrownErr).toBeInstanceOf(ValidationError);
      expect((thrownErr as ValidationError).message).toMatch(/exceeded maximum allowed size limit/i);

      if (stagedTempPath) {
        expect(await storageService.pathExists(stagedTempPath)).toBe(false);
      }
    } finally {
      if (originalMax !== undefined) {
        process.env.AIVA_MAX_UPLOAD_BYTES = originalMax;
      } else {
        delete process.env.AIVA_MAX_UPLOAD_BYTES;
      }
      resetEnvCache();
    }
  });
});
