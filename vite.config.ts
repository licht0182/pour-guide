import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const base = '/pour-guide/';
const versionPath = `${base}version.json`;

// vite.config.ts is type-checked without @types/node, so read env values defensively.
function readEnv(name: string): string | undefined {
  const proc: unknown = Reflect.get(globalThis, 'process');
  if (!proc || typeof proc !== 'object' || !('env' in proc)) return undefined;
  const env: unknown = proc.env;
  if (!env || typeof env !== 'object') return undefined;
  const value: unknown = Reflect.get(env, name);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveBuildVersion(): string {
  const explicit = readEnv('VITE_APP_VERSION');
  if (explicit) return explicit.slice(0, 120);
  const sha = readEnv('GITHUB_SHA');
  if (sha) {
    const runId = readEnv('GITHUB_RUN_ID');
    return `ci-${sha.slice(0, 7)}${runId ? `-${runId}` : ''}`;
  }
  // Local builds get a fresh identifier per invocation.
  return `local-${Date.now().toString(36)}`;
}

const buildVersion = resolveBuildVersion();
const buildPayload = JSON.stringify({ version: buildVersion });

// The Node http types are unavailable here (no @types/node), so narrow the
// request defensively instead of asserting a shape.
function requestPathname(req: object): string {
  const target =
    'originalUrl' in req && typeof req.originalUrl === 'string'
      ? req.originalUrl
      : 'url' in req && typeof req.url === 'string'
        ? req.url
        : '';
  try {
    return new URL(target || '/', 'http://localhost').pathname;
  } catch {
    return '';
  }
}

// Smoke seam: the servers may advertise a version other than the bundle's, which
// is what an update looks like. Never applied to `vite build`, so a deployed
// artifact always carries a version.json matching its own JS.
const remoteVersion = readEnv('VITE_APP_VERSION_REMOTE');
const servedPayload = JSON.stringify({ version: remoteVersion ?? buildVersion });

// Minimal structural shapes: @types/node is absent, so these mirror the parts of
// the Node/Connect middleware contract that this plugin actually uses.
interface VersionResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

function createVersionMiddleware(payload: string) {
  return (req: object, res: VersionResponse, next: () => void): void => {
    if (requestPathname(req) !== versionPath) {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.end(payload);
  };
}

function appVersionPlugin(): Plugin[] {
  const middleware = createVersionMiddleware(servedPayload);

  return [
    {
      name: 'pour-guide:version-servers',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use(middleware);
      },
      // `vite preview` serves dist/version.json itself; replace it only when a
      // smoke run advertises a version other than the built one.
      configurePreviewServer: remoteVersion
        ? server => {
            server.middlewares.use(middleware);
          }
        : undefined,
    },
    {
      name: 'pour-guide:version-build',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: buildPayload });
      },
    },
  ];
}

export default defineConfig({
  plugins: [react(), ...appVersionPlugin()],
  base,
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
  },
});
