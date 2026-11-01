export const KID_AVATAR_KEYS = ["sofia", "noah", "xavier"] as const;

export type KidAvatarKey = (typeof KID_AVATAR_KEYS)[number];

export function isKidAvatarKey(value: string | null | undefined): value is KidAvatarKey {
  return Boolean(value && (KID_AVATAR_KEYS as readonly string[]).includes(value));
}

/** Web public path for a stored avatar key. Expo uses bundled webp copies. */
export function avatarSrc(key: string | null | undefined): string | null {
  if (!isKidAvatarKey(key)) return null;
  return `/avatars/${key}.jpg`;
}

/** Meal photos may be a public path, a Blob URL, or a local upload token. */
export function mealPhotoSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("/")) return path;
  return `/api/photos/${encodeURIComponent(path)}`;
}
