const { spawnSync } = require('node:child_process');
// Match the application's Node 24 runtime for document-worker parsing.
const result = spawnSync(
  require('electron'),
  [
    '--test',
    'tests/store.test.cjs',
    'tests/model.test.cjs',
    'tests/documents.test.cjs',
    'tests/chunking.test.cjs',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
);
process.exit(result.status ?? 1);
