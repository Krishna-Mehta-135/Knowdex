export function requiredProvenance(
  name: string,
  value: string | undefined,
): string {
  if (!value || value === "unknown" || value === "0") {
    throw new Error(`self-check failed: ${name} must be provided`);
  }
  return value;
}
