import { DomainError } from "@/domain/errors";
import type { DirectorScene } from "@/domain/director";
import type { TimedToken, TimelineSceneDto } from "./timeline.types";

export function mapScenesToTimedTokens(scenes: DirectorScene[], tokens: TimedToken[]): TimelineSceneDto[] {
  return [...scenes].sort((a, b) => a.order - b.order).map((scene) => {
    if (!scene.id) throw new DomainError("INVALID_DIRECTOR_SCENE", "Persisted Director scene identity is required");
    const overlapping = tokens.filter((token) => token.sourceEnd > scene.sourceSpanStart && token.sourceStart < scene.sourceSpanEnd);
    if (overlapping.length === 0 && scene.text.trim().replace(/[\s\p{P}]+/gu, "").length > 0) {
      throw new DomainError("UNMAPPABLE_SCENE_TIMING", `Scene ${scene.order} has narration but no overlapping timed tokens`);
    }
    const startMs = Math.min(...overlapping.map((token) => token.startMs));
    const endMs = Math.max(...overlapping.map((token) => token.endMs));
    return { directorSceneId: scene.id, sequence: scene.order, sourceStart: scene.sourceSpanStart, sourceEnd: scene.sourceSpanEnd, startMs, endMs, durationMs: endMs - startMs };
  });
}
