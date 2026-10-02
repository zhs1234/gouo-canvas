// Synthetic private cold backups only. No business constructors, HTTP, recovery,
// source checkpoint, account setup or automatic service start.
import { DatabaseSync, backup } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, lstatSync, readdirSync, chmodSync, chownSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve, parse, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const sourceCommit = '0aec08fee811ec6136828fda790551b49e410301'
export const binarySha256 = 'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529'
export class BackupError extends Error { constructor(code) { super(code); this.name = 'BackupError' } }
export function guard(condition, code) { if (!condition) throw new BackupError(code) }
export const digest = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex')
const hex = value => typeof value === 'string' && /^[a-f\d]{64}$/.test(value)
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)
const quote = name => '"' + name.replaceAll('"', '""') + '"'

export function safePath(path, missingFinal = false) {
  const absolute = resolve(path), root = parse(absolute).root
  let current = root
  const parts = absolute.slice(root.length).split(/[\\/]/).filter(Boolean)
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    try { guard(!lstatSync(current).isSymbolicLink(), 'SYMLINK_PATH_REJECTED') }
    catch (error) { if (error.code === 'ENOENT' && missingFinal && index === parts.length - 1) return absolute; throw error }
  }
  return absolute
}
export async function fileProof(path) {
  safePath(path); const stat = lstatSync(path)
  guard(stat.isFile() && stat.size > 0 && stat.size <= 2 * 1024 ** 3, 'INVALID_BACKUP_FILE')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { bytes: stat.size, sha256: hash.digest('hex') }
}
export function validateProof(proof) {
  guard(proof?.sourceCommit === sourceCommit && proof.binarySha256 === binarySha256 && uuid(proof.instanceId), 'PIN_OR_INSTANCE_REJECTED')
  for (const name of ['nativeImage', 'studioImage']) guard(/^sha256:[a-f\d]{64}$/.test(proof[name] ?? ''), 'IMAGE_PROOF_REJECTED')
  for (const name of ['apiSourceHash', 'fixtureSourceHash', 'policyHash', 'nativeConfigHash', 'studioConfigHash']) guard(hex(proof[name]), 'CONFIG_PROOF_REJECTED')
  return Object.fromEntries(['sourceCommit', 'binarySha256', 'instanceId', 'nativeImage', 'studioImage', 'apiSourceHash', 'fixtureSourceHash', 'policyHash', 'nativeConfigHash', 'studioConfigHash'].map(name => [name, proof[name]]))
}
const active = ['running', 'claiming', 'reserved', 'pending', 'accepted', 'ready', 'submission_started', 'submitted', 'output_received', 'output_saved']
function inspectDatabase(db) {
  guard(db.prepare('PRAGMA integrity_check').all().every(row => Object.values(row)[0] === 'ok'), 'DATABASE_INTEGRITY_REJECTED')
  guard(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'DATABASE_FOREIGN_KEY_REJECTED')
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all()
  const tables = schema.filter(row => row.type === 'table' && !row.name.startsWith('sqlite_stat')).map(row => row.name)
  guard(tables.every(name => /^[A-Za-z_][A-Za-z\d_]*$/.test(name)), 'DATABASE_TABLE_REJECTED')
  const summaries = tables.map(table => {
    const hash = createHash('sha256'); let rows = 0
    const statement = db.prepare('SELECT * FROM ' + quote(table) + ' ORDER BY rowid'); statement.setReadBigInts(true)
    for (const row of statement.iterate()) {
      hash.update(JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? { integer: String(value) }
        : value instanceof Uint8Array ? { blob: Buffer.from(value).toString('base64') } : value) + '\n'); rows++
    }
    return { table, rows, hash: hash.digest('hex') }
  })
  return { schemaHash: digest(schema), logicalHash: digest(summaries), tables: summaries }
}
export function inspectPair({ nativePath, studioPath, instanceId }) {
  guard(uuid(instanceId), 'PIN_OR_INSTANCE_REJECTED'); safePath(nativePath); safePath(studioPath)
  guard(resolve(nativePath) !== resolve(studioPath), 'PAIR_PATH_REJECTED')
  let native, studio
  try {
    native = new DatabaseSync(nativePath, { readOnly: true }); studio = new DatabaseSync(studioPath, { readOnly: true })
    const nativeSummary = inspectDatabase(native), studioSummary = inspectDatabase(studio)
    const nativeTables = new Set(nativeSummary.tables.map(row => row.table)), studioTables = new Set(studioSummary.tables.map(row => row.table))
    for (const table of ['users', 'channels', 'tokens', 'user_subscriptions', 'subscription_pre_consume_records', 'logs', 'options']) guard(nativeTables.has(table), 'NATIVE_SCHEMA_REJECTED')
    for (const table of ['requests', 'trial_installation', 'trial_grants', 'trial_reservations', 'studio_threads', 'studio_runs', 'studio_run_events', 'studio_projects', 'studio_assets']) guard(studioTables.has(table), 'STUDIO_SCHEMA_REJECTED')
    guard(studio.prepare('SELECT instance_id FROM trial_installation WHERE id=1').get()?.instance_id === instanceId, 'DATABASE_INSTANCE_REJECTED')
    const users = native.prepare('SELECT id FROM users').all(), owners = new Set(users.map(row => row.id))
    guard(users.length > 0 && users.every(row => Number.isSafeInteger(row.id) && row.id > 0), 'NATIVE_OWNER_REJECTED')
    const channels = native.prepare('SELECT type,status,base_url,key FROM channels').all()
    guard(channels.length > 0 && channels.every(row => row.type === 1 && row.status === 1 && row.base_url === 'http://fixture-provider:19000'
      && row.key === 'fixture-provider-zero-procurement-cost'), 'NON_SYNTHETIC_CHANNEL_REJECTED')
    for (const table of studioTables) {
      const columns = new Set(studio.prepare('PRAGMA table_info(' + quote(table) + ')').all().map(row => row.name))
      if (columns.has('owner')) guard(studio.prepare('SELECT DISTINCT owner FROM ' + quote(table)).all().every(row => owners.has(row.owner)), 'FOREIGN_NATIVE_OWNER_REJECTED')
      if (columns.has('status')) guard(!studio.prepare('SELECT 1 FROM ' + quote(table) + ' WHERE status IN (' + active.map(() => '?').join(',') + ') LIMIT 1').get(...active), 'ACTIVE_OPERATION_REJECTED')
      if (columns.has('bytes') && columns.has('sha256')) for (const row of studio.prepare('SELECT bytes,sha256 FROM ' + quote(table)).iterate()) guard(row.bytes instanceof Uint8Array && digest(row.bytes) === row.sha256, 'PRIVATE_BLOB_HASH_REJECTED')
    }
    for (const run of studio.prepare('SELECT owner,thread_id FROM studio_runs').iterate()) guard(studio.prepare('SELECT 1 FROM studio_threads WHERE owner=? AND id=?').get(run.owner, run.thread_id), 'FOREIGN_THREAD_REJECTED')
    for (const event of studio.prepare('SELECT owner,run_id FROM studio_run_events').iterate()) guard(studio.prepare('SELECT 1 FROM studio_runs WHERE owner=? AND run_id=?').get(event.owner, event.run_id), 'FOREIGN_EVENT_REJECTED')
    const assets = studio.prepare('SELECT id,owner,run_id,tool_call_id,artifact_index,sha256,length(bytes) AS bytes FROM studio_assets ORDER BY id').all()
    const assetOwners = new Map(assets.map(row => [row.id, row.owner]))
    for (const table of ['image_job_reservations', 'image_job_outbox', 'image_job_staging']) if (studioTables.has(table)) {
      guard(studioTables.has('image_jobs'), 'JOB_SCHEMA_REJECTED')
      for (const row of studio.prepare('SELECT owner,key FROM ' + quote(table)).iterate()) guard(studio.prepare('SELECT 1 FROM image_jobs WHERE owner=? AND key=?').get(row.owner, row.key), 'FOREIGN_JOB_RECORD_REJECTED')
    }
    if (studioTables.has('image_jobs')) for (const row of studio.prepare('SELECT owner,asset_id FROM image_jobs WHERE asset_id IS NOT NULL').iterate()) guard(assetOwners.get(row.asset_id) === row.owner, 'FOREIGN_JOB_ASSET_REJECTED')
    for (const asset of assets) {
      if (asset.tool_call_id === 'image-job') {
        guard(studioTables.has('image_jobs') && studio.prepare('SELECT 1 FROM image_jobs WHERE owner=? AND key=? AND asset_id=?').get(asset.owner, asset.run_id, asset.id), 'FOREIGN_JOB_ASSET_REJECTED')
      } else {
        const run = studio.prepare('SELECT status,events FROM studio_runs WHERE owner=? AND run_id=?').get(asset.owner, asset.run_id)
        guard(run, 'FOREIGN_ASSET_RUN_REJECTED')
        const events = run.status === 'unknown' ? studio.prepare('SELECT event FROM studio_run_events WHERE owner=? AND run_id=? ORDER BY sequence').all(asset.owner, asset.run_id).map(row => JSON.parse(row.event)) : JSON.parse(run.events)
        const artifact = events.find(event => event.type === 'tool.completed' && event.toolCallId === asset.tool_call_id)?.artifacts?.[asset.artifact_index]
        guard(artifact?.type === 'image' && typeof artifact.url === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(artifact.url)
          && digest(Buffer.from(artifact.url.split(',')[1], 'base64')) === asset.sha256, 'ASSET_ORIGINAL_REJECTED')
      }
    }
    const projects = studio.prepare('SELECT id,owner,revision,document,source_asset_id FROM studio_projects ORDER BY id').all().map(row => {
      const document = JSON.parse(row.document), references = [row.source_asset_id, ...Object.values(document.files ?? {}).map(file => file.assetId),
        ...(document.elements ?? []).flatMap(element => [element.assetId, element.customData?.assetId])].filter(value => value != null)
      guard(references.every(id => assetOwners.get(id) === row.owner), 'FOREIGN_PROJECT_ASSET_REJECTED')
      guard(Number.isSafeInteger(row.revision) && row.revision > 0, 'PROJECT_REVISION_REJECTED')
      return { id: row.id, owner: row.owner, revision: row.revision, documentHash: digest(row.document) }
    })
    for (const row of studio.prepare('SELECT owner,subscription_id FROM trial_grants WHERE subscription_id IS NOT NULL').iterate()) guard(native.prepare('SELECT 1 FROM user_subscriptions WHERE id=? AND user_id=?').get(row.subscription_id, row.owner), 'FOREIGN_SUBSCRIPTION_REJECTED')
    if (studioTables.has('relay_bindings')) for (const row of studio.prepare('SELECT owner,token_id FROM relay_bindings').iterate()) guard(native.prepare('SELECT 1 FROM tokens WHERE id=? AND user_id=?').get(row.token_id, row.owner), 'FOREIGN_TOKEN_BINDING_REJECTED')
    const held = studio.prepare("SELECT owner,benefit,status,COUNT(*) AS count FROM trial_reservations WHERE status='unknown' GROUP BY owner,benefit,status ORDER BY owner,benefit").all().map(row => ({ ...row }))
    return { native: nativeSummary, studio: studioSummary, ownerCount: owners.size, assets: assets.map(({ id, owner, sha256, bytes }) => ({ id, owner, sha256, bytes })), projects, held }
  } finally { studio?.close(); native?.close() }
}
async function canonicalBackup(source, target) {
  safePath(source); safePath(target, true)
  guard(!lstatSync(target, { throwIfNoEntry: false }), 'BACKUP_TARGET_EXISTS')
  let db
  try { db = new DatabaseSync(source, { readOnly: true }); await backup(db, target) } finally { db?.close() }
  // Normalize only our new backup. The original source/WAL is never checkpointed.
  const output = new DatabaseSync(target)
  try { output.exec('PRAGMA journal_mode=DELETE') } finally { output.close() }
  chmodSync(target, 0o600)
}
export async function createPairBackup({ nativePath, studioPath, directory, proof, sourceBinding }) {
  proof = validateProof(proof); safePath(directory); guard(readdirSync(directory).length === 0, 'BACKUP_DIRECTORY_NOT_EMPTY')
  const before = inspectPair({ nativePath, studioPath, instanceId: proof.instanceId })
  await canonicalBackup(nativePath, join(directory, 'native.sqlite')); await canonicalBackup(studioPath, join(directory, 'studio.sqlite'))
  const summary = inspectPair({ nativePath: join(directory, 'native.sqlite'), studioPath: join(directory, 'studio.sqlite'), instanceId: proof.instanceId })
  guard(digest(summary) === digest(before), 'BACKUP_PAIR_CHANGED')
  const files = { native: await fileProof(join(directory, 'native.sqlite')), studio: await fileProof(join(directory, 'studio.sqlite')) }
  const manifest = { version: 1, scope: 'synthetic-private-only', backupId: randomUUID(), createdAt: new Date().toISOString(), proof, files, summary,
    ...(sourceBinding ? { sourceBinding } : {}) }
  manifest.pairHash = digest(manifest)
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 })
  return manifest
}
export async function verifyPair(directory, expectedProof) {
  safePath(directory)
  guard(readdirSync(directory).sort().join(',') === 'manifest.json,native.sqlite,studio.sqlite', 'BACKUP_DIRECTORY_CONTENT_REJECTED')
  const { readFile } = await import('node:fs/promises')
  safePath(join(directory, 'manifest.json'))
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')), { pairHash, ...signed } = manifest
  guard(manifest.version === 1 && manifest.scope === 'synthetic-private-only' && uuid(manifest.backupId) && hex(pairHash) && digest(signed) === pairHash, 'MANIFEST_PAIR_REJECTED')
  const proof = validateProof(manifest.proof)
  guard(!expectedProof || digest(proof) === digest(validateProof(expectedProof)), 'VERSION_CONFIG_OR_SECRET_CHANGED')
  for (const name of ['native', 'studio']) guard(digest(await fileProof(join(directory, name + '.sqlite'))) === digest(manifest.files?.[name]), 'BACKUP_FILE_HASH_REJECTED')
  const summary = inspectPair({ nativePath: join(directory, 'native.sqlite'), studioPath: join(directory, 'studio.sqlite'), instanceId: proof.instanceId })
  guard(digest(summary) === digest(manifest.summary), 'BACKUP_LOGICAL_PAIR_REJECTED')
  return manifest
}
export async function restorePair({ backupDirectory, nativeTarget, studioTarget, expectedProof, studioUid }) {
  guard(studioUid === undefined || studioUid === 1000, 'RESTORE_USER_REJECTED')
  const manifest = await verifyPair(backupDirectory, expectedProof)
  safePath(nativeTarget); safePath(studioTarget)
  guard(resolve(nativeTarget) !== resolve(studioTarget) && ![nativeTarget, studioTarget].some(path => resolve(path) === resolve(backupDirectory)), 'RESTORE_TARGET_REJECTED')
  guard(readdirSync(nativeTarget).length === 0 && readdirSync(studioTarget).length === 0, 'RESTORE_TARGET_NOT_EMPTY')
  await canonicalBackup(join(backupDirectory, 'native.sqlite'), join(nativeTarget, 'new-api.db'))
  await canonicalBackup(join(backupDirectory, 'studio.sqlite'), join(studioTarget, 'requests.sqlite'))
  const summary = inspectPair({ nativePath: join(nativeTarget, 'new-api.db'), studioPath: join(studioTarget, 'requests.sqlite'), instanceId: manifest.proof.instanceId })
  guard(digest(summary) === digest(manifest.summary), 'RESTORED_PAIR_CHANGED')
  if (studioUid !== undefined) {
    chownSync(studioTarget, 1000, 1000); chmodSync(studioTarget, 0o700)
    chownSync(join(studioTarget, 'requests.sqlite'), 1000, 1000)
    chmodSync(nativeTarget, 0o700)
  }
  return { backupId: manifest.backupId, pairHash: manifest.pairHash, logicalHash: digest(summary), instanceId: manifest.proof.instanceId,
    bothDatabasesVerified: true, servicesStarted: false, modelsCalled: 0 }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    guard(process.argv[2] === 'restore' && process.argv.length === 4, 'HELPER_ARGUMENT_REJECTED')
    const result = await restorePair(JSON.parse(process.argv[3]))
    console.log(JSON.stringify({ ok: true, ...result }))
  } catch (error) { console.log(JSON.stringify({ ok: false, code: error instanceof BackupError ? error.message : 'BACKUP_OPERATION_FAILED', rawErrorExcluded: true, servicesStarted: false })); process.exitCode = 1 }
}
