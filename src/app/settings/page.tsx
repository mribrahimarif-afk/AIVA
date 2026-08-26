import { getSettingsSnapshot } from "@/services/settings.service";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-base-800 py-3 last:border-b-0">
      <span className="text-sm text-neutral-400">{label}</span>
      <span className="text-sm text-neutral-100">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const settings = await getSettingsSnapshot();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-neutral-50">Settings</h1>

      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-3 text-sm font-medium text-neutral-400">General</h2>
          <SettingRow label="Storage root" value={<code className="text-xs">{settings.storageRoot}</code>} />
          <SettingRow label="Default aspect ratio" value={settings.defaultAspectRatio} />
          <SettingRow label="Log level" value={settings.logLevel} />
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-medium text-neutral-400">FFmpeg</h2>
          <SettingRow
            label="Detected"
            value={
              settings.ffmpeg.detected ? (
                <Badge tone="success">Available{settings.ffmpeg.version ? ` (${settings.ffmpeg.version})` : ""}</Badge>
              ) : (
                <Badge tone="warning">Not found</Badge>
              )
            }
          />
          <SettingRow label="Resolved path" value={<code className="text-xs">{settings.ffmpeg.resolvedPath}</code>} />
          <SettingRow
            label="Configured path"
            value={settings.ffmpeg.configuredPath ?? <span className="text-neutral-500">Not set (using PATH)</span>}
          />
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-medium text-neutral-400">Providers</h2>
          {settings.providers.map((provider) => (
            <SettingRow
              key={provider.id}
              label={provider.label}
              value={
                provider.status === "CONFIGURED" ? (
                  <Badge tone="success">CONFIGURED</Badge>
                ) : (
                  <Badge tone="neutral">NOT CONFIGURED</Badge>
                )
              }
            />
          ))}
        </Card>
      </div>
    </div>
  );
}
