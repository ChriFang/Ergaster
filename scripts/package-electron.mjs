import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');

const platform = process.argv[2] ?? process.platform;
const arch = process.argv[3] ?? process.arch;
const retainedLocales = new Set(['zh-CN.pak', 'en-US.pak']);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function normalizeVersion(versionRange) {
  return versionRange?.replace(/^[^0-9]*/, '');
}

async function getElectronVersion() {
  try {
    const lockFile = await readJson(path.join(rootDir, 'package-lock.json'));
    const lockedVersion = lockFile.packages?.['node_modules/electron']?.version;
    if (lockedVersion) {
      return lockedVersion;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return normalizeVersion(sourcePackageJson.devDependencies?.electron)
    ?? normalizeVersion(sourcePackageJson.dependencies?.electron);
}

const sourcePackageJson = await readJson(path.join(rootDir, 'package.json'));
const appName = sourcePackageJson.productName ?? sourcePackageJson.name;
const electronVersion = await getElectronVersion();

if (!electronVersion) {
  throw new Error('Unable to determine Electron version from package-lock.json or package.json.');
}

const packageRootDir = await mkdtemp(path.join(tmpdir(), 'ergaster-package-'));
const packageDir = path.join(packageRootDir, 'app');

await rm(packageDir, { recursive: true, force: true });
await mkdir(path.join(packageDir, 'dist'), { recursive: true });
await mkdir(path.join(packageDir, 'assets'), { recursive: true });

await cp(path.join(rootDir, 'dist', 'main'), path.join(packageDir, 'dist', 'main'), { recursive: true });
await cp(path.join(rootDir, 'dist', 'preload'), path.join(packageDir, 'dist', 'preload'), { recursive: true });
await cp(path.join(rootDir, 'dist', 'renderer'), path.join(packageDir, 'dist', 'renderer'), { recursive: true });

const iconFile = platform === 'win32' ? 'icon.ico' : 'icon.icns';
const iconPath = path.join(packageDir, 'assets', iconFile);
await copyFile(path.join(rootDir, 'assets', iconFile), iconPath);

const shouldEditWindowsResources = platform !== 'win32'
  || process.platform === 'win32'
  || process.env.ELECTRON_PACKAGER_USE_WIN_RESOURCES === '1';
const shouldApplyIcon = shouldEditWindowsResources;

if (platform === 'win32' && !shouldEditWindowsResources) {
  console.warn('Skipping Windows executable resources while packaging from non-Windows host. Set ELECTRON_PACKAGER_USE_WIN_RESOURCES=1 if Wine is installed.');
}

const packagedPackageJson = {
  name: sourcePackageJson.name,
  productName: sourcePackageJson.productName,
  version: sourcePackageJson.version,
  private: sourcePackageJson.private,
  description: sourcePackageJson.description,
  main: sourcePackageJson.main,
};

await writeFile(
  path.join(packageDir, 'package.json'),
  `${JSON.stringify(packagedPackageJson, null, 2)}\n`,
);

async function pruneLocales(outputDir) {
  const localesDir = path.join(outputDir, 'locales');
  let localeFiles;

  try {
    localeFiles = await readdir(localesDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  await Promise.all(
    localeFiles
      .filter((fileName) => fileName.endsWith('.pak') && !retainedLocales.has(fileName))
      .map((fileName) => rm(path.join(localesDir, fileName), { force: true })),
  );
}

async function packageWindowsWithoutResourceEditing() {
  const { downloadArtifact } = await import('@electron/get');
  const extractZip = (await import('extract-zip')).default;
  const stagingDir = await mkdtemp(path.join(tmpdir(), 'ergaster-win32-'));

  try {
    const zipPath = await downloadArtifact({
      version: electronVersion,
      artifactName: 'electron',
      platform: 'win32',
      arch,
    });

    await extractZip(zipPath, { dir: stagingDir });

    const outputDir = path.join(releaseDir, `${appName}-win32-${arch}`);
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(path.dirname(outputDir), { recursive: true });
    await cp(stagingDir, outputDir, { recursive: true });

    await rm(path.join(outputDir, 'resources', 'default_app.asar'), { force: true });
    await cp(packageDir, path.join(outputDir, 'resources', 'app'), { recursive: true });

    const executableName = `${appName}.exe`;
    await rm(path.join(outputDir, executableName), { force: true });
    await cp(path.join(outputDir, 'electron.exe'), path.join(outputDir, executableName));
    await rm(path.join(outputDir, 'electron.exe'), { force: true });
    await pruneLocales(outputDir);

    console.log(`Wrote new app to: ${outputDir}`);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

async function packageWithElectronPackager() {
  const packager = require('electron-packager');
  const options = {
    dir: packageDir,
    name: appName,
    executableName: appName,
    platform,
    arch,
    out: releaseDir,
    overwrite: true,
    electronVersion,
  };

  if (shouldApplyIcon) {
    options.icon = iconPath;
  }

  const appPaths = await packager(options);
  for (const appPath of appPaths) {
    await pruneLocales(appPath);
    console.log(`Wrote new app to: ${appPath}`);
  }
}

try {
  if (platform === 'win32' && !shouldEditWindowsResources) {
    await packageWindowsWithoutResourceEditing();
  } else {
    await packageWithElectronPackager();
  }
} finally {
  await rm(packageRootDir, { recursive: true, force: true });
}
