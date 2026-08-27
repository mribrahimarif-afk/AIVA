import { describe, expect, it } from "vitest";
import { toAsset, toProject, toScene } from "@/repositories/mappers";
import { DataIntegrityError } from "@/domain/errors";

const baseProjectRow = {
  id: "proj_1",
  name: "Valid Project",
  script: "",
  status: "DRAFT",
  aspectRatio: "9:16",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseSceneRow = {
  id: "scene_1",
  projectId: "proj_1",
  sequence: 0,
  text: "hello",
  status: "PENDING",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseAssetRow = {
  id: "asset_1",
  title: null,
  originalFilename: null,
  type: "SOURCE",
  vaultRole: null,
  source: "LOCAL_UPLOAD",
  localPath: null,
  mimeType: null,
  sizeBytes: null,
  checksum: null,
  metadata: null,
  projectId: null,
  brandId: null,
  productId: null,
  blobId: null,
  createdAt: new Date(),
};

describe("toProject", () => {
  it("maps a valid row to a domain Project", () => {
    const project = toProject(baseProjectRow);
    expect(project.status).toBe("DRAFT");
    expect(project.aspectRatio).toBe("9:16");
  });

  it("throws DataIntegrityError for a corrupted status value", () => {
    expect(() => toProject({ ...baseProjectRow, status: "NOT_A_REAL_STATUS" })).toThrow(DataIntegrityError);
  });

  it("throws DataIntegrityError for a corrupted aspect ratio value", () => {
    expect(() => toProject({ ...baseProjectRow, aspectRatio: "21:9" })).toThrow(DataIntegrityError);
  });

  it("includes the record id and field name in the thrown error's details", () => {
    try {
      toProject({ ...baseProjectRow, status: "GARBAGE" });
      expect.unreachable("expected toProject to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DataIntegrityError);
      const dataError = error as DataIntegrityError;
      expect(dataError.details?.recordId).toBe("proj_1");
      expect(dataError.details?.field).toBe("Project.status");
    }
  });
});

describe("toScene", () => {
  it("maps a valid row to a domain Scene", () => {
    expect(toScene(baseSceneRow).status).toBe("PENDING");
  });

  it("throws DataIntegrityError for a corrupted status value", () => {
    expect(() => toScene({ ...baseSceneRow, status: "BOGUS" })).toThrow(DataIntegrityError);
  });
});

describe("toAsset", () => {
  it("maps a valid row to a domain Asset", () => {
    const asset = toAsset(baseAssetRow);
    expect(asset.type).toBe("SOURCE");
    expect(asset.source).toBe("LOCAL_UPLOAD");
  });

  it("throws DataIntegrityError for a corrupted type value", () => {
    expect(() => toAsset({ ...baseAssetRow, type: "NOT_A_TYPE" })).toThrow(DataIntegrityError);
  });

  it("throws DataIntegrityError for a corrupted source value", () => {
    expect(() => toAsset({ ...baseAssetRow, source: "NOT_A_SOURCE" })).toThrow(DataIntegrityError);
  });

  it("throws DataIntegrityError for corrupt JSON in metadata column", () => {
    expect(() => toAsset({ ...baseAssetRow, metadata: "{invalid_json:true" })).toThrow(DataIntegrityError);
  });
});
