import "server-only";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

import { ARGON_OPTIONS } from "./argon-params";

export { ARGON_OPTIONS };

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argonVerify(passwordHash, password);
  } catch {
    // A malformed or truncated hash must read as "invalid credentials", never
    // as an exception that could leak the difference to the client.
    return false;
  }
}

/**
 * Password policy. Kept deliberately modest but real: length does the heavy
 * lifting, and we reject the obviously weak rather than pretending to score
 * complexity. Enforced identically on the client and the server.
 */
export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_RULES,
  validatePassword,
} from "./password-policy";
