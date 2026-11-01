export type PersonRole = "parent" | "kid";

export type PersonSlug = "focus" | "jess" | "sofia" | "noah" | "xavier";

export type PersonColor = {
  slug: PersonSlug;
  name: string;
  role: PersonRole;
  /** OKLCH used as the identity color on every surface. */
  color: string;
  pinLength: 4 | 6;
};

/**
 * Seeded household. Colors sit on Solstice cream:
 * Focus vermilion-brown, Jess olive, Sofia rose, Noah slate, Xavier gold.
 */
export const FAMILY: PersonColor[] = [
  { slug: "focus", name: "Focus", role: "parent", color: "oklch(42% 0.12 28)", pinLength: 6 },
  { slug: "jess", name: "Jess", role: "parent", color: "oklch(46% 0.08 150)", pinLength: 6 },
  { slug: "sofia", name: "Sofia", role: "kid", color: "oklch(52% 0.12 8)", pinLength: 4 },
  { slug: "noah", name: "Noah", role: "kid", color: "oklch(46% 0.09 250)", pinLength: 4 },
  { slug: "xavier", name: "Xavier", role: "kid", color: "oklch(62% 0.13 80)", pinLength: 4 },
];

export const KIDS = FAMILY.filter((p) => p.role === "kid");
export const PARENTS = FAMILY.filter((p) => p.role === "parent");

export function personBySlug(slug: string): PersonColor | undefined {
  return FAMILY.find((p) => p.slug === slug);
}
