import { getEnv } from "@/infrastructure/config/env";

export type ProviderConfigStatus = "CONFIGURED" | "NOT_CONFIGURED";

export interface ProviderStatusEntry {
  id: string;
  label: string;
  status: ProviderConfigStatus;
}

/**
 * Reports whether each future provider integration has credentials
 * present, without ever using those credentials. TASK-001 surfaces this
 * purely for the Settings screen; no provider is called.
 */
export function getProviderStatuses(): ProviderStatusEntry[] {
  const env = getEnv();

  const isSet = (value: string): boolean => value.trim().length > 0;
  const statusOf = (allSet: boolean): ProviderConfigStatus => (allSet ? "CONFIGURED" : "NOT_CONFIGURED");

  return [
    { id: "gemini", label: "Gemini", status: statusOf(isSet(env.GEMINI_API_KEY)) },
    {
      id: "azure-speech",
      label: "Azure Speech",
      status: statusOf(isSet(env.AZURE_SPEECH_KEY) && isSet(env.AZURE_SPEECH_REGION)),
    },
    { id: "pexels", label: "Pexels", status: statusOf(isSet(env.PEXELS_API_KEY)) },
    { id: "pixabay", label: "Pixabay", status: statusOf(isSet(env.PIXABAY_API_KEY)) },
  ];
}
