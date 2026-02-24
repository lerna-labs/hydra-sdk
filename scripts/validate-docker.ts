#!/usr/bin/env tsx
/**
 * Docker & Infrastructure Validator
 *
 * Validates Docker compose files, Dockerfiles, env variable layering,
 * port conflicts, volume mounts, Makefile references, and image tags.
 *
 * Usage: npx tsx scripts/validate-docker.ts
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { execSync } from "node:child_process";

// ── Types & Constants ──────────────────────────────────────────────

interface CheckResult {
  severity: "pass" | "warn" | "error";
  category: string;
  message: string;
  file?: string;
}

const ROOT = resolve(import.meta.dirname, "..");
const DOCKER_DIR = join(ROOT, "docker");

const KNOWN_NETWORKS = ["offline", "preview", "preprod", "mainnet"] as const;

// Variables that are supplied dynamically by Make or at runtime
const DYNAMIC_VARS = new Set([
  "NETWORK",
  "INSTANCE",
  "NODE_ID",
  "CARDANO_TESTNET_MAGIC",
  "RUST_LOG",
  "NODE_ENV",
]);

// ── Utilities ──────────────────────────────────────────────────────

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function fileIsEmpty(path: string): boolean {
  try {
    const stat = statSync(path);
    if (stat.size === 0) return true;
    const content = readFileSync(path, "utf-8");
    return content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length <= 1;
  } catch {
    return false;
  }
}

function parseEnvFile(path: string): Map<string, string> {
  const vars = new Map<string, string>();
  const content = readFileSafe(path);
  if (!content) return vars;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars.set(key, val);
  }
  return vars;
}

function parseComposeVars(path: string): Set<string> {
  const vars = new Set<string>();
  const content = readFileSafe(path);
  if (!content) return vars;

  const re = /\$\{([A-Z_][A-Z0-9_]*)(?::-[^}]*)?\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    vars.add(match[1]);
  }
  return vars;
}

function parseDockerfilePaths(
  path: string,
): Array<{ line: number; instruction: string; src: string }> {
  const results: Array<{ line: number; instruction: string; src: string }> = [];
  const content = readFileSafe(path);
  if (!content) return results;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const match = trimmed.match(/^(COPY|ADD)\s+(.+)\s+\S+$/i);
    if (!match) continue;
    const instruction = match[1];
    // Handle multi-source COPY, but the last token is destination
    const tokens = match[2].split(/\s+/);
    for (const token of tokens) {
      if (token.startsWith("--")) continue; // --from=, --chown=, etc.
      results.push({ line: i + 1, instruction, src: token });
    }
  }
  return results;
}

function getComposeFiles(): string[] {
  const files: string[] = [];
  for (const name of [
    "docker-compose.cardano.yml",
    "docker-compose.keys.yml",
    "docker-compose.offline.yml",
    "docker-compose.preview.yml",
    "docker-compose.preprod.yml",
    "docker-compose.mainnet.yml",
  ]) {
    const p = join(DOCKER_DIR, name);
    if (existsSync(p)) files.push(p);
  }
  return files;
}

function networkForComposeFile(filename: string): string[] {
  // Cross-network files
  if (filename.includes("cardano") || filename.includes("keys")) {
    return [...KNOWN_NETWORKS];
  }
  for (const net of KNOWN_NETWORKS) {
    if (filename.includes(net)) return [net];
  }
  return [...KNOWN_NETWORKS];
}

function buildEnvLayer(
  network: string,
  includeExamples = false,
): Map<string, string> {
  const merged = new Map<string, string>();

  // Example files as lowest-priority fallback (if requested)
  if (includeExamples) {
    for (const [k, v] of parseEnvFile(join(ROOT, ".example.env")))
      merged.set(k, v);
    for (const [k, v] of parseEnvFile(
      join(ROOT, `.example.${network}.env`),
    ))
      merged.set(k, v);
    for (const inst of ["alpha", "beta", "gamma"]) {
      const p = join(ROOT, `.example.${network}.${inst}.env`);
      if (existsSync(p)) {
        for (const [k, v] of parseEnvFile(p)) merged.set(k, v);
      }
    }
  }

  // Layer 1: .env
  for (const [k, v] of parseEnvFile(join(ROOT, ".env"))) merged.set(k, v);
  // Layer 2: .{NETWORK}.env
  for (const [k, v] of parseEnvFile(join(ROOT, `.${network}.env`)))
    merged.set(k, v);
  // Layer 3: any .{NETWORK}.*.env files
  for (const inst of ["alpha", "beta", "gamma"]) {
    const p = join(ROOT, `.${network}.${inst}.env`);
    if (existsSync(p)) {
      for (const [k, v] of parseEnvFile(p)) merged.set(k, v);
    }
  }
  return merged;
}

function parsePorts(
  content: string,
): Array<{ host: string; container: string; raw: string }> {
  const ports: Array<{ host: string; container: string; raw: string }> = [];
  const lines = content.split("\n");
  let inPorts = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "ports:") {
      inPorts = true;
      continue;
    }
    if (inPorts) {
      if (trimmed.startsWith("- ")) {
        let portSpec = trimmed.slice(2).replace(/^["']|["']$/g, "");
        const parts = portSpec.split(":");
        if (parts.length >= 2) {
          ports.push({
            host: parts[0],
            container: parts[parts.length - 1],
            raw: portSpec,
          });
        }
      } else if (!trimmed.startsWith("#") && trimmed !== "") {
        inPorts = false;
      }
    }
  }
  return ports;
}

function resolvePortVar(
  port: string,
  envVars: Map<string, string>,
): string | null {
  const match = port.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
  if (match) {
    return envVars.get(match[1]) ?? null;
  }
  if (/^\d+$/.test(port)) return port;
  return null;
}

// ── Check Functions ────────────────────────────────────────────────

function checkDockerfiles(): CheckResult[] {
  const results: CheckResult[] = [];
  const dockerfiles = [join(DOCKER_DIR, "Dockerfile.express")];

  for (const df of dockerfiles) {
    if (!existsSync(df)) continue;
    const relDf = relative(ROOT, df);
    const paths = parseDockerfilePaths(df);

    // The offline compose sets context: .. (repo root)
    const buildContext = ROOT;

    for (const { line, instruction, src } of paths) {
      // Check for paths escaping build context
      if (src.startsWith("../")) {
        results.push({
          severity: "warn",
          category: "Dockerfile",
          message: `${instruction} source \`${src}\` escapes build context with \`../\``,
          file: `${relDf}:${line}`,
        });
        // Still check if the intended file exists at build context root
        // by stripping the ../ prefix (what the deployer likely meant)
        const stripped = src.replace(/^\.\.\//g, "");
        const resolved = resolve(buildContext, stripped);
        // Skip glob patterns (e.g. package*.json) — can't check with existsSync
        if (!stripped.includes("*") && !existsSync(resolved)) {
          const isMiddleware = src.includes("packages/middleware");
          results.push({
            severity: "warn",
            category: "Dockerfile",
            message: isMiddleware
              ? `${instruction} source \`${src}\` not present (deployer extension point)`
              : `${instruction} source \`${stripped}\` does not exist in build context`,
            file: `${relDf}:${line}`,
          });
        }
      } else {
        // Non-escaping path — check relative to build context
        const resolved = resolve(buildContext, src);
        if (!src.includes("*") && !existsSync(resolved)) {
          const isMiddleware = src.includes("packages/middleware");
          results.push({
            severity: "warn",
            category: "Dockerfile",
            message: isMiddleware
              ? `${instruction} source \`${src}\` not present (deployer extension point)`
              : `${instruction} source \`${src}\` does not exist`,
            file: `${relDf}:${line}`,
          });
        }
      }
    }

    if (paths.length === 0) {
      results.push({
        severity: "pass",
        category: "Dockerfile",
        message: "No COPY/ADD instructions found",
        file: relDf,
      });
    }
  }

  if (results.length === 0) {
    results.push({
      severity: "pass",
      category: "Dockerfile",
      message: "All Dockerfile paths validated",
    });
  }
  return results;
}

function checkComposeVariableUsage(): CheckResult[] {
  const results: CheckResult[] = [];
  const composeFiles = getComposeFiles();

  for (const cf of composeFiles) {
    const relCf = relative(ROOT, cf);
    // Check for empty/incomplete files
    if (fileIsEmpty(cf)) {
      results.push({
        severity: "warn",
        category: "Compose",
        message: "File is empty or incomplete",
        file: relCf,
      });
      continue;
    }

    const content = readFileSafe(cf);
    if (!content) continue;

    // Check image: lines for hardcoded tags
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const imageMatch = trimmed.match(/^image:\s*(.+)$/);
      if (!imageMatch) continue;
      const imageVal = imageMatch[1].trim();
      // Should use ${VAR} syntax
      if (!imageVal.includes("${") && imageVal.includes(":")) {
        results.push({
          severity: "warn",
          category: "Compose",
          message: `Hardcoded image tag: \`${imageVal}\` — consider using \${VAR} syntax`,
          file: `${relCf}:${i + 1}`,
        });
      }
    }
  }

  if (!results.some((r) => r.severity !== "pass")) {
    results.push({
      severity: "pass",
      category: "Compose",
      message: "All compose files use variable-based image tags",
    });
  }
  return results;
}

function checkEnvCrossReference(): CheckResult[] {
  const results: CheckResult[] = [];
  const composeFiles = getComposeFiles();

  // For each network, collect referenced vars and available env vars
  for (const network of KNOWN_NETWORKS) {
    const envVars = buildEnvLayer(network);
    const referencedVars = new Set<string>();

    // Collect vars from compose files applicable to this network
    for (const cf of composeFiles) {
      const networks = networkForComposeFile(relative(ROOT, cf));
      if (!networks.includes(network)) continue;
      for (const v of parseComposeVars(cf)) {
        referencedVars.add(v);
      }
    }

    // Check for vars referenced but not defined
    for (const v of referencedVars) {
      if (DYNAMIC_VARS.has(v)) continue;
      if (!envVars.has(v)) {
        results.push({
          severity: "warn",
          category: "Env",
          message: `\`${v}\` referenced in compose but not defined in any \`${network}\` env layer`,
        });
      }
    }

    // Check for vars defined but never referenced (only from network-specific env)
    const networkEnvPath = join(ROOT, `.${network}.env`);
    const networkEnvVars = parseEnvFile(networkEnvPath);
    for (const v of networkEnvVars.keys()) {
      if (DYNAMIC_VARS.has(v)) continue;
      if (!referencedVars.has(v)) {
        // Only warn for vars that seem Docker-related
        const dockerRelated = [
          "IMAGE",
          "PORT",
          "HOST",
          "DIR",
          "URL",
          "TLS",
          "TRP",
          "HYDRA",
          "CARDANO",
          "EXPRESS",
        ];
        const isDockerRelated = dockerRelated.some((keyword) =>
          v.includes(keyword),
        );
        if (isDockerRelated) {
          results.push({
            severity: "warn",
            category: "Env",
            message: `\`${v}\` defined in \`.${network}.env\` but not referenced in any compose file`,
          });
        }
      }
    }
  }

  if (!results.some((r) => r.severity !== "pass")) {
    results.push({
      severity: "pass",
      category: "Env",
      message: "All environment variables cross-referenced successfully",
    });
  }
  return results;
}

function checkPortConflicts(): CheckResult[] {
  const results: CheckResult[] = [];
  const composeFiles = getComposeFiles();

  // Track ports per network
  const networkPorts = new Map<
    string,
    Array<{ port: string; file: string; raw: string }>
  >();

  for (const cf of composeFiles) {
    const relCf = relative(ROOT, cf);
    const content = readFileSafe(cf);
    if (!content) continue;

    const ports = parsePorts(content);
    const networks = networkForComposeFile(relCf);

    for (const network of networks) {
      // Include example envs so we can detect port collisions even when
      // the real env files are minimal (e.g. .mainnet.env has only HYDRA_TX_ID)
      const envVars = buildEnvLayer(network, true);
      if (!networkPorts.has(network)) networkPorts.set(network, []);

      for (const { host, raw } of ports) {
        const resolved = resolvePortVar(host, envVars);
        if (resolved) {
          networkPorts.get(network)!.push({ port: resolved, file: relCf, raw });
        }
      }
    }
  }

  // Check within-network conflicts
  for (const [network, ports] of networkPorts) {
    const seen = new Map<string, { file: string; raw: string }>();
    for (const { port, file, raw } of ports) {
      const existing = seen.get(port);
      if (existing) {
        results.push({
          severity: "warn",
          category: "Ports",
          message: `Port ${port} conflict in \`${network}\`: \`${existing.file}\` (${existing.raw}) vs \`${file}\` (${raw})`,
        });
      } else {
        seen.set(port, { file, raw });
      }
    }
  }

  // Check cross-network collisions
  const allNetworks = [...networkPorts.keys()];
  for (let i = 0; i < allNetworks.length; i++) {
    for (let j = i + 1; j < allNetworks.length; j++) {
      const netA = allNetworks[i];
      const netB = allNetworks[j];
      const portsA = new Map(
        networkPorts.get(netA)!.map((p) => [p.port, p]),
      );
      for (const { port, file, raw } of networkPorts.get(netB)!) {
        const conflicting = portsA.get(port);
        if (conflicting) {
          results.push({
            severity: "warn",
            category: "Ports",
            message: `Cross-network port collision: ${port} used in both \`${netA}\` and \`${netB}\``,
          });
        }
      }
    }
  }

  if (!results.some((r) => r.severity !== "pass")) {
    results.push({
      severity: "pass",
      category: "Ports",
      message: "No port conflicts detected",
    });
  }

  // Deduplicate cross-network warnings
  const unique = new Map<string, CheckResult>();
  for (const r of results) {
    const key = `${r.category}:${r.message}`;
    if (!unique.has(key)) unique.set(key, r);
  }
  return [...unique.values()];
}

function checkVolumeMounts(): CheckResult[] {
  const results: CheckResult[] = [];
  const composeFiles = getComposeFiles();

  for (const cf of composeFiles) {
    const relCf = relative(ROOT, cf);
    const content = readFileSafe(cf);
    if (!content) continue;

    const lines = content.split("\n");
    let inVolumes = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "volumes:") {
        inVolumes = true;
        continue;
      }
      if (inVolumes) {
        if (trimmed.startsWith("- ")) {
          let volSpec = trimmed.slice(2).replace(/^["']|["']$/g, "");
          const colonParts = volSpec.split(":");
          if (colonParts.length < 2) continue; // Named volume or anonymous

          const hostPath = colonParts[0];
          // Skip system paths
          if (hostPath.startsWith("/etc/") || hostPath.startsWith("/var/")) continue;
          // Skip paths with variables (resolved at runtime)
          if (hostPath.includes("${")) continue;
          // Skip anonymous volumes (no host path)
          if (hostPath.startsWith("/")) continue;

          // Resolve relative to compose file directory
          const resolved = resolve(dirname(cf), hostPath);
          if (!existsSync(resolved)) {
            results.push({
              severity: "warn",
              category: "Volumes",
              message: `Bind mount \`${hostPath}\` does not exist (may be created at runtime by make targets)`,
              file: relCf,
            });
          }
        } else if (!trimmed.startsWith("#") && trimmed !== "" && !trimmed.startsWith("- ")) {
          inVolumes = false;
        }
      }
    }
  }

  if (!results.some((r) => r.severity !== "pass")) {
    results.push({
      severity: "pass",
      category: "Volumes",
      message: "All volume mounts validated",
    });
  }
  return results;
}

function checkMakefileConsistency(): CheckResult[] {
  const results: CheckResult[] = [];
  const makefileContent = readFileSafe(join(ROOT, "Makefile"));
  if (!makefileContent) {
    results.push({
      severity: "error",
      category: "Makefile",
      message: "Makefile not found",
    });
    return results;
  }

  // Extract compose file references from Makefile
  const composeRefs = new Set<string>();
  const re = /docker[/-]compose[\w.-]*\.yml/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(makefileContent)) !== null) {
    composeRefs.add(match[0]);
  }

  // Also handle the pattern docker-compose.$(NETWORK).yml
  if (makefileContent.includes("docker-compose.$(NETWORK).yml")) {
    for (const network of KNOWN_NETWORKS) {
      composeRefs.add(`docker-compose.${network}.yml`);
    }
  }

  for (const ref of composeRefs) {
    const fullPath = join(DOCKER_DIR, ref);
    if (!existsSync(fullPath)) {
      results.push({
        severity: "error",
        category: "Makefile",
        message: `Makefile references \`docker/${ref}\` but file does not exist`,
      });
    }
  }

  if (!results.some((r) => r.severity !== "pass")) {
    results.push({
      severity: "pass",
      category: "Makefile",
      message: "All Makefile compose file references are valid",
    });
  }
  return results;
}

function checkImageTagConsistency(): CheckResult[] {
  const results: CheckResult[] = [];

  const envVars = parseEnvFile(join(ROOT, ".env"));
  const exampleVars = parseEnvFile(join(ROOT, ".example.env"));

  if (exampleVars.size === 0) {
    results.push({
      severity: "warn",
      category: "Images",
      message: "`.example.env` not found or empty",
    });
    return results;
  }

  const imageKeys = [...envVars.keys()].filter((k) => k.endsWith("_IMAGE"));

  for (const key of imageKeys) {
    const envVal = envVars.get(key)!;
    const exampleVal = exampleVars.get(key);
    if (!exampleVal) {
      results.push({
        severity: "warn",
        category: "Images",
        message: `\`${key}\` defined in \`.env\` but missing from \`.example.env\``,
      });
    } else if (envVal !== exampleVal) {
      results.push({
        severity: "warn",
        category: "Images",
        message: `\`${key}\` differs: \`.env\` has \`${envVal.split(":")[1] ?? envVal}\`, \`.example.env\` has \`${exampleVal.split(":")[1] ?? exampleVal}\``,
      });
    }
  }

  // Check example has keys not in .env
  const exampleImageKeys = [...exampleVars.keys()].filter((k) =>
    k.endsWith("_IMAGE"),
  );
  for (const key of exampleImageKeys) {
    if (!envVars.has(key)) {
      results.push({
        severity: "warn",
        category: "Images",
        message: `\`${key}\` in \`.example.env\` but missing from \`.env\``,
      });
    }
  }

  if (!results.some((r) => r.severity !== "pass")) {
    results.push({
      severity: "pass",
      category: "Images",
      message: "Image tags are consistent between `.env` and `.example.env`",
    });
  }
  return results;
}

async function checkMiddlewareStaleness(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check all env layers for MIDDLEWARE_REPO
  const envVars = parseEnvFile(join(ROOT, ".env"));
  let middlewareRepo: string | undefined;

  // Check .env first, then network-level envs
  for (const [k, v] of envVars) {
    if (k === "MIDDLEWARE_REPO" && v) middlewareRepo = v;
  }
  if (!middlewareRepo) {
    for (const network of KNOWN_NETWORKS) {
      const networkEnv = parseEnvFile(join(ROOT, `.${network}.env`));
      const val = networkEnv.get("MIDDLEWARE_REPO");
      if (val) {
        middlewareRepo = val;
        break;
      }
    }
  }

  if (!middlewareRepo) {
    results.push({
      severity: "pass",
      category: "Middleware",
      message:
        "`MIDDLEWARE_REPO` not set — middleware staleness check skipped",
    });
    return results;
  }

  const middlewarePath = join(ROOT, "packages/middleware");

  if (!existsSync(middlewarePath)) {
    results.push({
      severity: "warn",
      category: "Middleware",
      message: `\`MIDDLEWARE_REPO\` is set to \`${middlewareRepo}\` but \`packages/middleware/\` does not exist — needs to be cloned`,
    });
    return results;
  }

  // Parse owner/repo from the URL
  const repoMatch = middlewareRepo.match(
    /(?:github\.com[/:])?([^/]+\/[^/.]+?)(?:\.git)?$/,
  );
  if (!repoMatch) {
    results.push({
      severity: "warn",
      category: "Middleware",
      message: `Could not parse GitHub owner/repo from \`MIDDLEWARE_REPO=${middlewareRepo}\``,
    });
    return results;
  }

  const ownerRepo = repoMatch[1];

  try {
    // Get latest remote commit
    const response = await fetch(
      `https://api.github.com/repos/${ownerRepo}/commits?per_page=1`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      results.push({
        severity: "warn",
        category: "Middleware",
        message: `GitHub API returned ${response.status} for \`${ownerRepo}\` — cannot check staleness`,
      });
      return results;
    }

    const commits = (await response.json()) as Array<{ sha: string }>;
    if (!commits.length) {
      results.push({
        severity: "warn",
        category: "Middleware",
        message: `No commits found for \`${ownerRepo}\``,
      });
      return results;
    }

    const latestSha = commits[0].sha;

    // Try to get local SHA
    let localSha: string | undefined;
    try {
      localSha = execSync("git rev-parse HEAD", {
        cwd: middlewarePath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
    } catch {
      // Not a git repo — check package.json version instead
      const pkgPath = join(middlewarePath, "package.json");
      if (existsSync(pkgPath)) {
        results.push({
          severity: "warn",
          category: "Middleware",
          message: `\`packages/middleware/\` is not a git repo — cannot compare SHA. Latest remote: ${latestSha.slice(0, 8)}`,
        });
      }
      return results;
    }

    if (localSha === latestSha) {
      results.push({
        severity: "pass",
        category: "Middleware",
        message: `\`packages/middleware/\` is up to date with \`${ownerRepo}\` (${latestSha.slice(0, 8)})`,
      });
    } else {
      results.push({
        severity: "warn",
        category: "Middleware",
        message: `\`packages/middleware/\` may be behind \`${ownerRepo}\`: local=${localSha.slice(0, 8)}, remote=${latestSha.slice(0, 8)}`,
      });
    }
  } catch (err) {
    results.push({
      severity: "warn",
      category: "Middleware",
      message: `Network error checking middleware staleness: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ── Report Formatting ──────────────────────────────────────────────

function formatReport(results: CheckResult[]): string {
  const lines: string[] = [];
  lines.push("# Docker Infrastructure Validation Report\n");

  // Group by category
  const categories = new Map<string, CheckResult[]>();
  for (const r of results) {
    if (!categories.has(r.category)) categories.set(r.category, []);
    categories.get(r.category)!.push(r);
  }

  const icons = { pass: "\u2705", warn: "\u26a0\ufe0f", error: "\u274c" };

  for (const [category, checks] of categories) {
    lines.push(`## ${category}\n`);
    for (const check of checks) {
      const icon = icons[check.severity];
      const filePart = check.file ? ` — \`${check.file}\`` : "";
      lines.push(`${icon} ${check.message}${filePart}`);
    }
    lines.push("");
  }

  // Summary
  const passes = results.filter((r) => r.severity === "pass").length;
  const warns = results.filter((r) => r.severity === "warn").length;
  const errors = results.filter((r) => r.severity === "error").length;

  lines.push("---");
  lines.push(
    `**Summary:** ${passes} passed, ${warns} warnings, ${errors} errors`,
  );

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const results: CheckResult[] = [];

  results.push(...checkDockerfiles());
  results.push(...checkComposeVariableUsage());
  results.push(...checkEnvCrossReference());
  results.push(...checkPortConflicts());
  results.push(...checkVolumeMounts());
  results.push(...checkMakefileConsistency());
  results.push(...checkImageTagConsistency());
  results.push(...(await checkMiddlewareStaleness()));

  const report = formatReport(results);
  console.log(report);

  const hasErrors = results.some((r) => r.severity === "error");
  process.exit(hasErrors ? 1 : 0);
}

main();
