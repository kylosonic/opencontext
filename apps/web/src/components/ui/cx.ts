/** Join class names, skipping falsy values. Zero-dependency cx(). */
export function cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
