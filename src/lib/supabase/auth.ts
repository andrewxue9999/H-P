type CookieStore = {
  getAll(): Array<{ name: string; value: string }>;
};

type CookieMutator = {
  set(name: string, value: string, options?: Record<string, unknown>): void;
};

export function isRefreshTokenNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "refresh_token_not_found"
  );
}

export function clearSupabaseAuthCookies(cookieSource: CookieStore, cookieTarget: CookieMutator) {
  for (const cookie of cookieSource.getAll()) {
    if (!cookie.name.startsWith("sb-") || !cookie.name.includes("-auth-token")) {
      continue;
    }

    cookieTarget.set(cookie.name, "", {
      expires: new Date(0),
      maxAge: 0,
      path: "/",
    });
  }
}
