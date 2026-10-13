/**
 * Password policy. No `server-only` guard, because the client renders the same
 * rules the server enforces. Keeping one definition means a field can never be
 * rejected by the API after the form accepted it.
 *
 * Deliberately modest but real: length does the heavy lifting, and we reject the
 * obviously weak rather than pretending to score complexity.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export const PASSWORD_RULES = [
  {
    id: "length",
    label: "At least 10 characters",
    test: (v: string) => v.length >= PASSWORD_MIN_LENGTH,
  },
  { id: "upper", label: "An uppercase letter", test: (v: string) => /[A-Z]/.test(v) },
  { id: "lower", label: "A lowercase letter", test: (v: string) => /[a-z]/.test(v) },
  { id: "digit", label: "A number", test: (v: string) => /[0-9]/.test(v) },
] as const;

export function validatePassword(password: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label);
}
