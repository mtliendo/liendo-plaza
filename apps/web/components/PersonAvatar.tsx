import Image from "next/image";
import { avatarSrc } from "@liendo/shared";

export type AvatarPerson = {
  name: string;
  role?: "parent" | "kid";
  color: string;
  avatarKey?: string | null;
};

export function PersonAvatar({
  person,
  size,
  className = "",
}: {
  person: AvatarPerson;
  size: number;
  className?: string;
}) {
  const src = avatarSrc(person.avatarKey);
  return (
    <span
      className={`avatar ${className}`.trim()}
      style={{
        width: size,
        height: size,
        ["--person" as string]: person.color,
        fontSize: Math.round(size * 0.42),
      }}
      aria-hidden={src ? true : undefined}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          width={size}
          height={size}
          sizes={`${size}px`}
          className="avatar-photo"
        />
      ) : (
        <span className="monogram">{person.name.slice(0, 1)}</span>
      )}
    </span>
  );
}
