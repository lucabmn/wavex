import { getDefaultHostId, invokeOn } from "../transport";
import { type HostId } from "../host";
import { assetSrc, openDialog as open } from "../native";
import {
  notifyTabGroupLogosChanged,
  saveTabGroupLogo,
  tabGroupLogoDisplayRevision,
} from "../workspace/tabGroups";

export async function pickImageFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Choose project logo",
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
      },
    ],
  });
  if (typeof selected === "string" && selected) return selected;
  return null;
}

export async function pickAndSetProjectLogo(
  project: string,
  hostId: HostId = getDefaultHostId(),
): Promise<string | null> {
  const sourcePath = await pickImageFile();
  if (!sourcePath) return null;
  const path = await invokeOn<string>(hostId, "save_project_logo", {
    project,
    sourcePath,
  });
  saveTabGroupLogo(project, path);
  notifyTabGroupLogosChanged();
  return path;
}

export async function clearProjectLogo(
  project: string,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  await invokeOn(hostId, "remove_project_logo", { project });
  saveTabGroupLogo(project, null);
  notifyTabGroupLogosChanged();
}

export function projectLogoSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  const src = assetSrc(path);
  // A browser tab has no scheme for a file on disk, and the logo is a client
  // convenience rather than project data, so it falls back to the mascot.
  return src ? `${src}?v=${tabGroupLogoDisplayRevision()}` : null;
}
