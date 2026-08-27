import type {
  DirectorAiProvider,
  DirectorPromptInput,
  DirectorRepairInput,
} from "@/providers/ai";
import type { RawDirectorOutput, RawDirectorScene } from "@/domain/director";

export class FakeDirectorProvider implements DirectorAiProvider {
  readonly id = "fake-director";
  readonly modelName = "gemini-3.7-flash-mock";
  readonly fallbackModelName = "gemini-3.6-flash-mock";
  public configured = true;
  public analyzeCallCount = 0;
  public repairCallCount = 0;
  public lastAnalyzeInput: DirectorPromptInput | null = null;
  public lastRepairInput: DirectorRepairInput | null = null;

  public customAnalyze?: (input: DirectorPromptInput) => Promise<RawDirectorOutput>;
  public customRepair?: (input: DirectorRepairInput) => Promise<RawDirectorOutput>;
  public failFirstAttemptWithInvalid = false;
  public errorToThrow: Error | null = null;

  isConfigured(): boolean {
    return this.configured;
  }

  async analyze(input: DirectorPromptInput): Promise<RawDirectorOutput> {
    this.analyzeCallCount++;
    this.lastAnalyzeInput = input;

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    if (this.customAnalyze) {
      return this.customAnalyze(input);
    }

    if (this.failFirstAttemptWithInvalid) {
      // Return invalid output with missing unit to trigger repair
      return {
        language: "ENGLISH",
        contentType: "ADVERTISEMENT",
        summary: "Mock initial invalid summary",
        creativeDirection: "Mock initial invalid direction",
        scenes: [
          {
            order: 1,
            unitIds: [input.scriptUnits[0]?.id || "u0001"],
            purpose: "HOOK",
            visualBrief: "Initial brief with missing subsequent units",
            visualSourceHint: "STOCK",
            shotType: "LIFESTYLE",
            mood: "Energetic",
            setting: "Urban",
            subject: "Person",
            productPresence: "PREFERRED",
            searchQuery: "urban runner morning",
            keywords: ["urban", "runner"],
            manualAiPrompt: null,
          },
        ],
      };
    }

    return this.generateDefaultValidPlan(input);
  }

  async repair(input: DirectorRepairInput): Promise<RawDirectorOutput> {
    this.repairCallCount++;
    this.lastRepairInput = input;

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    if (this.customRepair) {
      return this.customRepair(input);
    }

    return this.generateDefaultValidPlan(input);
  }

  public generateDefaultValidPlan(input: DirectorPromptInput): RawDirectorOutput {
    const units = input.scriptUnits;
    if (units.length === 0) {
      return {
        language: "ENGLISH",
        contentType: "ADVERTISEMENT",
        summary: "Empty script plan",
        creativeDirection: "Minimal visual direction",
        scenes: [],
      };
    }

    // Split units into 2 balanced scenes if multiple units exist, or 1 scene
    const midpoint = Math.ceil(units.length / 2);
    const scene1Units = units.slice(0, midpoint);
    const scene2Units = units.slice(midpoint);

    const scenes: RawDirectorScene[] = [
      {
        order: 1,
        unitIds: scene1Units.map((u) => u.id),
        purpose: "HOOK",
        visualBrief: "Dynamic opening scene introducing the core product visual hook.",
        visualSourceHint: "PRODUCT_LIBRARY",
        shotType: "PRODUCT_HERO",
        mood: "Exciting and vibrant",
        setting: "Modern studio space",
        subject: input.productContext?.name || "Featured Product",
        productPresence: "REQUIRED",
        searchQuery: "premium product packaging showcase",
        keywords: ["product", "showcase", "commercial"],
        manualAiPrompt: null,
      },
    ];

    if (scene2Units.length > 0) {
      scenes.push({
        order: 2,
        unitIds: scene2Units.map((u) => u.id),
        purpose: "CTA",
        visualBrief: "Call to action with closing lifestyle shot and brand resolution.",
        visualSourceHint: "STOCK",
        shotType: "LIFESTYLE",
        mood: "Confident and inspiring",
        setting: "Sunlit outdoor environment",
        subject: "Happy customer",
        productPresence: "PREFERRED",
        searchQuery: "satisfied customer outdoor lifestyle",
        keywords: ["lifestyle", "happy", "action"],
        manualAiPrompt: null,
      });
    }

    return {
      language: "ENGLISH",
      contentType: "ADVERTISEMENT",
      summary: `Engaging commercial featuring ${input.productContext?.name || "the product"}.`,
      creativeDirection: "Sleek modern commercial with fast-paced visual storytelling.",
      scenes,
      model: this.modelName,
    };
  }
}
