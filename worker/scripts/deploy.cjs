const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

function assertTaskState(version) {
  if (!version.resources?.bindings?.some(binding => binding.name === 'TASKS_STATE' && binding.type === 'durable_object_namespace')) {
    throw new Error('Release has no TaskState binding; refuse to route users to obsolete KV data.');
  }
}
function assertDeployment(deployment, versionID) {
  if (deployment.versions?.length !== 1 || deployment.versions[0].version_id !== versionID || deployment.versions[0].percentage !== 100) {
    throw new Error('Active deployment differs from the verified release. Check concurrent deployments before proceeding.');
  }
}
function main() {
  const root = resolve(__dirname, '..');
  const config = resolve(root, 'wrangler.jsonc');
  const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  const parsed = JSON.parse(readFileSync(config, 'utf8'));
  if (!parsed.durable_objects?.bindings?.some(binding => binding.name === 'TASKS_STATE' && binding.class_name === 'TaskState')) {
    throw new Error('Deployment config must retain the original TaskState binding.');
  }
  function run(args, json = false) {
    const result = spawnSync(process.execPath, [wrangler, ...args, '--config', config], {
      cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_SEND_METRICS: 'false' },
    });
    if (!json) { process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); }
    if (result.error || result.status !== 0) throw new Error(`Wrangler ${args.slice(0, 2).join(' ')} failed; release is not verified.`);
    return json ? JSON.parse(result.stdout) : result.stdout;
  }
  const output = run(['deploy']);
  const versionID = output.match(/Current Version ID:\s*([a-f0-9-]{36})/i)?.[1];
  if (!versionID) throw new Error('No uploaded version ID; release is not verified.');
  assertTaskState(run(['versions', 'view', versionID, '--json'], true));
  // Trigger/settings updates have produced follow-up versions without the DO
  // binding. Finish by explicitly deploying the verified, immutable upload.
  run(['versions', 'deploy', `${versionID}@100`, '--yes']);
  const deployment = run(['deployments', 'status', '--json'], true);
  assertDeployment(deployment, versionID);
  assertTaskState(run(['versions', 'view', versionID, '--json'], true));
  mkdirSync(resolve(root, '.wrangler'), { recursive: true });
  writeFileSync(resolve(root, '.wrangler/last-verified-release.json'), JSON.stringify({ versionID, verifiedAt: new Date().toISOString() }, null, 2));
  console.log(`Verified production: ${versionID}, 100% traffic, TaskState binding retained.`);
}
module.exports = { assertTaskState, assertDeployment };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
