const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-portable-qa-'));
try {
  const packaged = spawnSync(process.execPath, ['scripts/package.cjs', '--out', root], {
    stdio: 'inherit',
  });
  if (packaged.status !== 0) throw new Error('Portable packaging failed');
  const executable = path.join(root, 'LocalAI Knowledge-win32-x64', 'LocalAIKnowledge.exe');
  const checked = spawnSync(process.execPath, ['tests/documents-desktop.cjs', '--packaged'], {
    stdio: 'inherit',
    env: { ...process.env, LOCALAI_TEST_EXECUTABLE: executable },
  });
  if (checked.status !== 0) throw new Error('Portable Word/PDF checks failed');
  console.log('PASS portable app outside project, without access to project node_modules');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('localai-portable-qa-'));
  fs.rmSync(root, { recursive: true, force: true });
}
