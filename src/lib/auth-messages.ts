// Sign-in helpers shared by the login, sign-up and account screens. Pure, tested.

export const MIN_PASSWORD = 10;

/** A short reason the password isn't good enough, or null. (Supabase enforces its own minimum too.) */
export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 72) return "Use at most 72 characters.";
  if (/^(.)\1+$/.test(password)) return "Don't repeat one character.";
  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return "Don't use your email address in the password.";
  if (["password12", "1234567890", "qwertyuiop", "firstline1"].some((w) => password.toLowerCase().startsWith(w))) return "That password is too easy to guess.";
  return null;
}

/** Supabase auth errors in plain words. Never says whether an email address has an account. */
export function friendlyAuthError(e: { code?: string; message?: string; name?: string } | null | undefined): string {
  if (!e) return "Something went wrong. Try again.";
  const code = e.code ?? "";
  const msg = e.message ?? "";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) return "Wrong email or password.";
  if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) return "Confirm your email address first: open the link we sent you.";
  if (code === "weak_password" || /weak|password should/i.test(msg)) return `Choose a stronger password (at least ${MIN_PASSWORD} characters, not easy to guess).`;
  if (code === "user_already_exists" || /already registered/i.test(msg)) return "Check your inbox to continue."; // don't reveal existing accounts
  if (code.startsWith("over_") || /rate limit|too many/i.test(msg)) return "Too many tries. Wait a minute and try again.";
  if (code === "same_password") return "That's your current password. Choose a new one.";
  if (code === "reauthentication_needed") return "For your safety, sign in again before changing your password.";
  if (code === "webauthn_challenge_expired") return "The passkey request expired. Try again.";
  if (/NotAllowedError|ERROR_CEREMONY_ABORTED|aborted|cancel/i.test(`${e.name ?? ""} ${code} ${msg}`)) return "Passkey cancelled.";
  if (/passkey|webauthn/i.test(`${code} ${msg}`)) return "That passkey didn't work. Try again or sign in another way.";
  if (/provider is not enabled|unsupported provider/i.test(msg)) return "This sign-in option isn't switched on yet. Use email instead.";
  return msg || "Something went wrong. Try again.";
}

/** Does this browser support passkeys at all? */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

/** For useSyncExternalStore: passkey support never changes while the page is open. */
export const noSubscribe = () => () => {};
export const passkeysSupportedOnServer = () => false;
