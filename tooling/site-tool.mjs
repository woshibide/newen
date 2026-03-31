import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const outDir = path.join(rootDir, 'dist');

const excludedNames = new Set([
  '.git',
  '.github',
  'node_modules',
  'dist',
  'tooling',
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
]);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const mode = argv[2] ?? 'dev';
  const options = {
    port: 4173,
    watch: true,
  };

  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--no-watch') {
      options.watch = false;
      continue;
    }

    if (token === '--watch') {
      options.watch = true;
      continue;
    }

    if (token === '--port') {
      const next = argv[index + 1];
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.port = parsed;
        index += 1;
      }
    }
  }

  return { mode, options };
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function shouldCopyAbsolutePath(absolutePath) {
  const relativePath = path.relative(rootDir, absolutePath);
  if (relativePath.startsWith('..')) {
    return false;
  }

  const firstSegment = relativePath.split(path.sep)[0];
  if (excludedNames.has(firstSegment)) {
    return false;
  }

  return true;
}

async function copyTree(sourceDir, destinationDir) {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (!(await shouldCopyAbsolutePath(sourcePath))) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyTree(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function buildSite(target) {
  await fs.rm(outDir, { recursive: true, force: true });
  await copyTree(rootDir, outDir);

  if (target === 'github') {
    await fs.writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');
  }

  const buildMeta = {
    target,
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(path.join(outDir, 'build-meta.json'), `${JSON.stringify(buildMeta, null, 2)}\n`, 'utf8');
}

function toFilePathFromRequest(urlPath) {
  const parsedPath = decodeURIComponent((urlPath ?? '/').split('?')[0].split('#')[0] || '/');
  const safePath = path.normalize(parsedPath).replace(/^\/+/, '');
  return path.join(outDir, safePath);
}

async function resolveRequestPath(urlPath) {
  const directPath = toFilePathFromRequest(urlPath);
  const relative = path.relative(outDir, directPath);
  if (relative.startsWith('..')) {
    return null;
  }

  if (await exists(directPath)) {
    const stats = await fs.stat(directPath);
    if (stats.isFile()) {
      return directPath;
    }
    if (stats.isDirectory()) {
      const nestedIndex = path.join(directPath, 'index.html');
      if (await exists(nestedIndex)) {
        return nestedIndex;
      }
    }
  }

  const withoutTrailingSlash = (urlPath ?? '/').replace(/\/$/, '');
  if (withoutTrailingSlash.length > 0) {
    const asDirectory = toFilePathFromRequest(`${withoutTrailingSlash}/index.html`);
    if (await exists(asDirectory)) {
      return asDirectory;
    }
  }

  return null;
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return mimeTypes[extension] ?? 'application/octet-stream';
}

async function startDevServer(port, watchEnabled) {
  await buildSite('local');

  const server = createServer(async (request, response) => {
    try {
      const filePath = await resolveRequestPath(request.url ?? '/');

      if (!filePath) {
        response.statusCode = 404;
        response.setHeader('content-type', 'text/plain; charset=utf-8');
        response.end('not found');
        return;
      }

      const content = await fs.readFile(filePath);
      response.statusCode = 200;
      response.setHeader('content-type', getMimeType(filePath));
      response.end(content);
    } catch {
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('server error');
    }
  });

  server.listen(port, () => {
    console.log(`dev server running at http://localhost:${port}`);
    console.log(`serving folder: ${outDir}`);
  });

  if (!watchEnabled) {
    return;
  }

  let buildTimer = null;
  const watcher = watch(rootDir, { recursive: true }, async (eventType, fileName) => {
    const changedName = String(fileName ?? '');
    if (!changedName) {
      return;
    }

    const firstSegment = changedName.split(path.sep)[0];
    if (excludedNames.has(firstSegment)) {
      return;
    }

    if (buildTimer) {
      clearTimeout(buildTimer);
    }

    buildTimer = setTimeout(async () => {
      try {
        await buildSite('local');
        console.log(`rebuilt after ${eventType}: ${changedName}`);
      } catch (error) {
        console.error('rebuild failed');
        if (error instanceof Error) {
          console.error(error.message);
        }
      }
    }, 120);
  });

  process.on('SIGINT', () => {
    watcher.close();
    server.close(() => process.exit(0));
  });
}

async function main() {
  const { mode, options } = parseArgs(process.argv);

  if (mode === 'build-local') {
    await buildSite('local');
    console.log('built local output in dist');
    return;
  }

  if (mode === 'build-github') {
    await buildSite('github');
    console.log('built github pages output in dist');
    return;
  }

  if (mode === 'dev') {
    await startDevServer(options.port, options.watch);
    return;
  }

  console.error(`unknown mode: ${mode}`);
  console.error('use one of: dev, build-local, build-github');
  process.exit(1);
}

main().catch((error) => {
  console.error('site tool failed');
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  }
  process.exit(1);
});
