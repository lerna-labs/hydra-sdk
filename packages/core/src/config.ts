/** Read a required environment variable or throw with a clear message. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Read an optional environment variable with a fallback default. */
export function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}
