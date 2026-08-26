/**
 * Minimal scene lifecycle for TASK-001. Scene intelligence (planning,
 * voice/asset linkage) is out of scope and will extend this set in a
 * later task.
 */
export const SCENE_STATUSES = ["PENDING", "READY", "FAILED"] as const;

export type SceneStatus = (typeof SCENE_STATUSES)[number];

export interface Scene {
  id: string;
  projectId: string;
  sequence: number;
  text: string;
  status: SceneStatus;
  createdAt: Date;
  updatedAt: Date;
}
