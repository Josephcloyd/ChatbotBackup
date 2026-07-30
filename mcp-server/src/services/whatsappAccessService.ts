export type GroupAccessConfig = {
  allowedGroupId: string;
  allowedGroupName: string;
};

export type ChatIdentity = {
  isGroup: boolean;
  id: string;
  name: string;
};

export function normalizeGroupName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function normalizeGroupAccessConfig(
  config: GroupAccessConfig,
): GroupAccessConfig {
  return {
    allowedGroupId: config.allowedGroupId.trim(),
    allowedGroupName: config.allowedGroupName.trim(),
  };
}

export function isAllowedWhatsAppGroup(
  chat: ChatIdentity,
  config: GroupAccessConfig,
): boolean {
  if (!chat.isGroup) {
    return false;
  }

  const normalizedConfig = normalizeGroupAccessConfig(config);

  if (normalizedConfig.allowedGroupId) {
    return chat.id === normalizedConfig.allowedGroupId;
  }

  if (!normalizedConfig.allowedGroupName) {
    return false;
  }

  return (
    normalizeGroupName(chat.name) ===
    normalizeGroupName(normalizedConfig.allowedGroupName)
  );
}

export function maskWhatsAppGroupId(groupId: string): string {
  const trimmedGroupId = groupId.trim();

  if (!trimmedGroupId) {
    return "(not configured)";
  }

  const suffix = "@g.us";
  const baseId = trimmedGroupId.endsWith(suffix)
    ? trimmedGroupId.slice(0, -suffix.length)
    : trimmedGroupId;

  if (baseId.length <= 6) {
    return `${baseId.slice(0, 1)}...${baseId.slice(-1)}${trimmedGroupId.endsWith(suffix) ? suffix : ""}`;
  }

  return `${baseId.slice(0, 3)}...${baseId.slice(-3)}${trimmedGroupId.endsWith(suffix) ? suffix : ""}`;
}
