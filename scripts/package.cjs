const { packager } = require('@electron/packager');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
function copyRuntimeDependencies(root, staging, names) {
  const copied = new Map();
  const visit = (name, from) => {
    const resolver = createRequire(path.join(from, 'package.json'));
    let directory;
    try {
      directory = path.dirname(resolver.resolve(name + '/package.json'));
    } catch {
      directory = path.dirname(resolver.resolve(name));
    }
    while (
      !fs.existsSync(path.join(directory, 'package.json')) ||
      JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).name !== name
    ) {
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error('Cannot locate runtime package ' + name);
      directory = parent;
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (copied.has(name)) {
      if (copied.get(name) !== pkg.version)
        throw new Error('Runtime dependency version conflict: ' + name);
      return;
    }
    copied.set(name, pkg.version);
    const target = path.join(staging, 'node_modules', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(directory, target, {
      recursive: true,
      filter: (source) => path.basename(source) !== 'node_modules',
    });
    for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency, directory);
  };
  for (const name of names) visit(name, root);
  return Object.fromEntries(copied);
}
async function main() {
  const root = path.resolve(__dirname, '..');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-package-'));
  try {
    for (const directory of ['dist', 'dist-electron'])
      fs.cpSync(path.join(root, directory), path.join(staging, directory), { recursive: true });
    fs.mkdirSync(path.join(staging, 'assets'));
    fs.copyFileSync(
      path.join(root, 'assets', 'app-icon.ico'),
      path.join(staging, 'assets', 'app-icon.ico'),
    );
    for (const file of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
      fs.copyFileSync(path.join(root, file), path.join(staging, file));
    const pkg = require('../package.json');
    copyRuntimeDependencies(root, staging, ['mammoth', 'unpdf']);
    fs.writeFileSync(
      path.join(staging, 'package.json'),
      JSON.stringify({
        name: pkg.name,
        productName: pkg.productName,
        version: pkg.version,
        main: pkg.main,
        license: pkg.license,
        dependencies: { mammoth: pkg.dependencies.mammoth, unpdf: pkg.dependencies.unpdf },
      }),
    );
    const outputs = await packager({
      dir: staging,
      out: process.argv.includes('--out')
        ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
        : path.join(root, 'release'),
      name: 'LocalAI Knowledge',
      executableName: 'LocalAIKnowledge',
      icon: path.join(root, 'assets', 'app-icon.ico'),
      platform: process.platform,
      arch: process.arch,
      electronVersion: require('electron/package.json').version,
      asar: true,
      prune: false,
      overwrite: true,
      appCopyright: 'LocalAI Knowledge contributors',
    });
    console.log('桌面应用已打包：\n' + outputs.join('\n'));
  } finally {
    // This is the exact mkdtemp directory created above, under the system temp directory.
    if (
      path.dirname(staging) !== path.resolve(os.tmpdir()) ||
      !path.basename(staging).startsWith('localai-package-')
    )
      throw new Error('Unexpected staging path');
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
