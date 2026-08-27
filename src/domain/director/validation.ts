import { rawDirectorOutputSchema } from "./director.schema";
import type { RawDirectorOutput, DirectorScene } from "./director.types";
import type { ScriptUnit } from "./unitizer";

export interface PlanValidationResult {
  readonly success: boolean;
  readonly scenes?: DirectorScene[];
  readonly errors: string[];
}

/**
 * Enforces the 10 Director scene coverage and contiguity invariants,
 * cross-field rules, and reconstructs exact scene narration locally from ScriptUnits.
 */
export function validateAndReconstructPlan(
  raw: unknown,
  units: readonly ScriptUnit[],
  originalScript: string
): PlanValidationResult {
  const errors: string[] = [];

  // 1. Zod schema validation
  const parsed = rawDirectorOutputSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`Schema error at ${issue.path.join(".") || "root"}: ${issue.message}`);
    }
    return { success: false, errors };
  }

  const data: RawDirectorOutput = parsed.data;

  if (units.length === 0) {
    errors.push("Script unit list is empty; cannot validate scene plan against 0 units");
    return { success: false, errors };
  }

  const unitMap = new Map<string, ScriptUnit>();
  for (const u of units) {
    unitMap.set(u.id, u);
  }

  // 2. Check scene order contiguous sequence 1..N
  for (let i = 0; i < data.scenes.length; i++) {
    const expectedOrder = i + 1;
    const scene = data.scenes[i];
    if (scene && scene.order !== expectedOrder) {
      errors.push(
        `Scene order non-contiguous: scene at index ${i} has order ${scene.order}, expected ${expectedOrder}`
      );
    }
  }

  // 3. Track unit coverage
  const seenUnitIds = new Set<string>();
  const flatAssignedUnitIds: string[] = [];

  const reconstructedScenes: DirectorScene[] = [];

  for (const s of data.scenes) {
    // 8. No empty scenes
    if (!s.unitIds || s.unitIds.length === 0) {
      errors.push(`Scene ${s.order}: scene contains no unitIds (must not be empty)`);
      continue;
    }

    // Cross-field rule: MANUAL_AI <==> manualAiPrompt is non-empty string
    if (s.visualSourceHint === "MANUAL_AI") {
      if (!s.manualAiPrompt || s.manualAiPrompt.trim().length === 0) {
        errors.push(
          `Scene ${s.order}: visualSourceHint is MANUAL_AI but manualAiPrompt is missing or empty`
        );
      }
    } else {
      if (s.manualAiPrompt !== null) {
        errors.push(
          `Scene ${s.order}: visualSourceHint is ${s.visualSourceHint} (not MANUAL_AI), so manualAiPrompt must be null`
        );
      }
    }

    // Real-Product Packaging Rule: productPresence REQUIRED cannot use MANUAL_AI
    if (s.productPresence === "REQUIRED" && s.visualSourceHint === "MANUAL_AI") {
      errors.push(
        `Scene ${s.order}: Real product packaging is required (productPresence=REQUIRED); visualSourceHint cannot be MANUAL_AI (must prefer PRODUCT_LIBRARY)`
      );
    }

    // Verify units inside this scene
    let prevUnitOrder = -1;
    const sceneUnits: ScriptUnit[] = [];

    for (const uid of s.unitIds) {
      // 4. No unknown units
      const unit = unitMap.get(uid);
      if (!unit) {
        errors.push(`Scene ${s.order}: references unknown unit ID "${uid}"`);
        continue;
      }

      // 3. No duplicate units across all scenes
      if (seenUnitIds.has(uid)) {
        errors.push(`Scene ${s.order}: unit ID "${uid}" is duplicated (appears more than once)`);
      }
      seenUnitIds.add(uid);
      flatAssignedUnitIds.push(uid);
      sceneUnits.push(unit);

      // 6. Contiguous units inside each scene
      if (prevUnitOrder !== -1 && unit.order !== prevUnitOrder + 1) {
        errors.push(
          `Scene ${s.order}: units inside scene are not contiguous (jump from unit order ${prevUnitOrder} to ${unit.order})`
        );
      }
      prevUnitOrder = unit.order;
    }

    if (sceneUnits.length > 0) {
      const firstUnit = sceneUnits[0];
      const lastUnit = sceneUnits[sceneUnits.length - 1];

      if (firstUnit && lastUnit) {
        // 9. Scene narration is reconstructed locally from ScriptUnits
        const sceneNarration = sceneUnits.map((u) => u.text).join("");

        reconstructedScenes.push({
          order: s.order,
          text: sceneNarration,
          unitIds: s.unitIds,
          purpose: s.purpose,
          visualBrief: s.visualBrief,
          visualSourceHint: s.visualSourceHint,
          shotType: s.shotType,
          mood: s.mood,
          setting: s.setting,
          subject: s.subject,
          productPresence: s.productPresence,
          searchQuery: s.searchQuery,
          keywords: s.keywords,
          manualAiPrompt: s.manualAiPrompt,
          sourceSpanStart: firstUnit.sourceStart,
          sourceSpanEnd: lastUnit.sourceEnd,
        });
      }
    }
  }

  // 1 & 2. Every ScriptUnit appears exactly once; no missing units
  for (const u of units) {
    if (!seenUnitIds.has(u.id)) {
      errors.push(`Missing unit: unit ID "${u.id}" (order ${u.order}) is not covered by any scene`);
    }
  }

  // 5. Preserved unit order across the entire plan
  for (let i = 0; i < flatAssignedUnitIds.length; i++) {
    const assignedId = flatAssignedUnitIds[i];
    const expectedId = units[i]?.id;
    if (assignedId !== expectedId) {
      errors.push(
        `Unit order mismatch at position ${i}: found "${assignedId}", expected "${expectedId}"`
      );
      break;
    }
  }

  // 10. Recombined scene narration reconstructs the original script exactly
  const fullReconstructed = reconstructedScenes.map((s) => s.text).join("");
  if (fullReconstructed !== originalScript) {
    errors.push(
      "Reconstructed full script from scenes does not match the original script exactly"
    );
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, scenes: reconstructedScenes, errors: [] };
}
