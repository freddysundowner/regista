// The product's name, in one place. Set APP_NAME in the environment file (.env.local when developing,
// /etc/rejista/rejista.env on a server) and rebuild: the web app, the API, emails, PDFs, the support
// assistant and the search-engine tags all pick it up.
//
// How it works: the source code says "Rejista" wherever the name appears, and both builds swap that word
// for APP_NAME. So when writing new text, just write "Rejista" and it follows the setting.
export const DEFAULT_NAME = "Rejista";

export function appName() {
  const name = (process.env.APP_NAME ?? "").trim() || DEFAULT_NAME;
  // The name lands inside strings and page text, so it is kept to characters that are safe in both.
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .-]{1,39}$/u.test(name)) {
    throw new Error(`APP_NAME "${name}" is not usable: use 2 to 40 letters, numbers, spaces, dots or hyphens, starting with a letter or number.`);
  }
  return name;
}

/** Swaps the name in a piece of source or HTML. A no-op while the name is the default. */
export function rebrand(text, name = appName()) {
  return name === DEFAULT_NAME || !text.includes(DEFAULT_NAME) ? text : text.replaceAll(DEFAULT_NAME, name);
}
