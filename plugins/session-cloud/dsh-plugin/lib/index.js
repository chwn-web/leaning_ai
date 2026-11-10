/**
 * dsh-session-cloud — host half.
 *
 * Registers two JSON endpoints under `/session-cloud` that drive the existing
 * zero-dependency engine `session-cloud/sync.py`:
 *
 *   GET  /session-cloud/state?sessionId=<id>   → one session's mode/size/time
 *   POST /session-cloud/mode {sessionId, mode} → `sync.py mode --session … --to …`
 *   GET  /session-cloud/health                 → python/engine probe (install check)
 *
 * Hard rules taken from the webserver contract
 * (`packages/host/webserver/src/index.ts:28-34`): a route handler owns the
 * FULL response lifecycle, so it always answers with `res.writeHead`/`res.end`
 * and never returns a `Response`. Every failure path is caught here: an
 * uncaught throw would tear down the plugin fiber (and, because the client
 * boot sweep is strict, take the whole web UI with it).
 */

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve as toAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Services this plugin needs before `apply` runs (cordis waits for them). */
export const inject = ['webServer']

/** Plugin id, mirroring the package name in `cordis.patch.yml`. */
export const name = 'dsh-session-cloud'

/** Route prefix. Registered as a `prefix` route, so every sub-path lands here. */
const ROUTE = '/session-cloud'
/** Per-invocation budget for `sync.py` (the task allows 20s; long enough for a slow python cold start). */
const TIMEOUT_MS = Number(process.env.DSH_SESSION_CLOUD_TIMEOUT_MS) > 0
  ? Number(process.env.DSH_SESSION_CLOUD_TIMEOUT_MS)
  : 20000
/** Body cap for POST /mode — the payload is two short strings. */
const MAX_BODY = 64 * 1024
/** `lib/` and the package root, resolved from this module's own URL. */
const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = dirname(LIB_DIR)

/* ------------------------------------------------------------------ logging */

const log = {
  warn(message, error) {
    try {
      // ctx.logger is absent when this module is imported outside a plugin
      // fiber (tests, dry runs); console is the honest fallback.
      if (error === undefined) console.warn(`[dsh-session-cloud] ${message}`)
      else console.warn(`[dsh-session-cloud] ${message}`, error)
    } catch { /* a broken console must not break the request path */ }
  },
}

/* ----------------------------------------------------------- engine location */

/**
 * Every place `sync.py` may live, most specific first. The source layout keeps
 * the plugin at `<session-cloud>/dsh-plugin/lib/`, but installation copies the
 * package into `<profile>/node_modules/`, where the relative answer is gone —
 * hence the config file / env / last-resort absolute candidate.
 * @returns absolute candidate paths, in probe order.
 */
function engineCandidates() {
  const out = []
  const fromEnv = process.env.DSH_SESSION_CLOUD_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') out.push(join(fromEnv.trim(), 'sync.py'))

  // Written by install.ps1: keeps state.json/config.json single-sourced.
  const cfgPath = join(PKG_DIR, 'session-cloud.json')
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
      if (cfg && typeof cfg.engineDir === 'string' && cfg.engineDir.trim() !== '') {
        out.push(join(cfg.engineDir.trim(), 'sync.py'))
      }
    } catch (error) {
      log.warn(`cannot parse ${cfgPath}`, error)
    }
  }

  out.push(join(PKG_DIR, 'sync.py'))           // engine copied next to the package
  out.push(join(PKG_DIR, '..', 'sync.py'))     // <session-cloud>/dsh-plugin → <session-cloud>
  out.push(join(PKG_DIR, '..', '..', 'sync.py')) // defensive: nested install root
  out.push('D:\\TCL\\leaning_AI_agent\\plugins\\session-cloud\\sync.py')
  return out.map(entry => toAbsolute(entry))
}

/**
 * Locate the engine directory.
 * @returns `{ script, dir }` with absolute paths.
 * @throws when no candidate exists — the caller turns this into a 500 with the
 *   full candidate list, which is exactly the diagnostic an install needs.
 */
function resolveEngine() {
  const candidates = engineCandidates()
  for (const script of candidates) {
    if (existsSync(script)) return { script, dir: dirname(script) }
  }
  throw new Error(`sync.py not found. Looked in: ${candidates.join(' | ')}`)
}

/* ----------------------------------------------------------- process runner */

/**
 * Run one command and capture stdout/stderr without ever throwing.
 *
 * Two transports, because one of them is not always permitted: the normal
 * piped path, and — when the OS refuses the pipes (`EPERM`, e.g. a confined
 * Windows sandbox) — a file-redirected fallback. The observable contract is
 * identical either way.
 * @param {string} file - executable or launcher.
 * @param {string[]} args - argv.
 * @param {{ cwd?: string, timeout?: number }} [options] - spawn options.
 * @returns {{ status: number | null, stdout: string, stderr: string, error?: Error }} capture.
 */
function execCapture(file, args, options = {}) {
  const timeout = options.timeout ?? TIMEOUT_MS
  const cwd = options.cwd
  // Force UTF-8 both ways: the engine prints Chinese labels and Windows would
  // otherwise hand back mojibake through the console code page.
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  let piped
  try {
    piped = spawnSync(file, args, { cwd, timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env })
  } catch (error) {
    return { status: null, stdout: '', stderr: '', error: error instanceof Error ? error : new Error(String(error)) }
  }
  const code = /** @type {any} */ (piped.error)?.code
  if (code !== 'EPERM') {
    const out = {
      status: piped.status ?? null,
      stdout: String(piped.stdout ?? ''),
      stderr: String(piped.stderr ?? ''),
    }
    return piped.error === undefined ? out : { ...out, error: piped.error }
  }
  return execCaptureRedirected(file, args, { cwd, timeout, env })
}

/**
 * Piped stdio was refused by the platform: rerun with the child's stdout and
 * stderr bound to temp files. Regular files are still permitted where pipes
 * are not, and the result is read back the same way.
 * @param {string} file - executable.
 * @param {string[]} args - argv.
 * @param {{ cwd?: string, timeout: number, env: NodeJS.ProcessEnv }} options - resolved options.
 * @returns {{ status: number | null, stdout: string, stderr: string, error?: Error }} capture.
 */
function execCaptureRedirected(file, args, options) {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const outPath = join(tmpdir(), `dsh-session-cloud-${stamp}.out`)
  const errPath = join(tmpdir(), `dsh-session-cloud-${stamp}.err`)
  let outFd
  let errFd
  try {
    outFd = openSync(outPath, 'w')
    errFd = openSync(errPath, 'w')
    const result = spawnSync(file, args, {
      cwd: options.cwd,
      timeout: options.timeout,
      windowsHide: true,
      stdio: ['ignore', outFd, errFd],
      env: options.env,
    })
    closeSync(outFd)
    outFd = undefined
    closeSync(errFd)
    errFd = undefined
    let stdout = ''
    let stderr = ''
    try { stdout = readFileSync(outPath, 'utf8') } catch { /* keep empty */ }
    try { stderr = readFileSync(errPath, 'utf8') } catch { /* keep empty */ }
    const out = { status: result.status ?? null, stdout, stderr }
    return result.error === undefined ? out : { ...out, error: result.error }
  } catch (error) {
    return { status: null, stdout: '', stderr: '', error: error instanceof Error ? error : new Error(String(error)) }
  } finally {
    if (outFd !== undefined) {
      try { closeSync(outFd) } catch { /* already closed */ }
    }
    if (errFd !== undefined) {
      try { closeSync(errFd) } catch { /* already closed */ }
    }
    try { rmSync(outPath, { force: true }) } catch { /* best effort */ }
    try { rmSync(errPath, { force: true }) } catch { /* best effort */ }
  }
}

/* ------------------------------------------------------------- python probe */

let pythonProbeCache

/**
 * Probe the python launchers once per process: `python`, then `py -3`, then
 * `python3`. The first launcher that answers `--version` wins; the probe list
 * is kept in order so a failing launcher can fall through on a bad install.
 * @returns `{ launchers, tried }`.
 */
function pythonLaunchers() {
  if (pythonProbeCache !== undefined) return pythonProbeCache
  const tried = []
  const launchers = []
  for (const candidate of [{ file: 'python', args: [] }, { file: 'py', args: ['-3'] }, { file: 'python3', args: [] }]) {
    const result = execCapture(candidate.file, [...candidate.args, '--version'], { timeout: 5000 })
    if (result.error !== undefined) {
      tried.push(`${candidate.file}: ${describeError(result.error)}`)
      continue
    }
    if (result.status === 0) {
      launchers.push(candidate)
      tried.push(`${candidate.file}: ok (${String(result.stdout || result.stderr || '').trim()})`)
    } else {
      tried.push(`${candidate.file}: exit ${String(result.status)} ${tail(result.stderr)}`.trim())
    }
  }
  pythonProbeCache = { launchers, tried }
  return pythonProbeCache
}

/** @param {unknown} error @returns {string} one-line error text. */
function describeError(error) {
  if (error instanceof Error) {
    const code = /** @type {any} */ (error).code
    return code === undefined ? error.message : `${code}: ${error.message}`
  }
  return String(error)
}

/** @param {unknown} value @returns {string} trimmed tail of a buffer/string. */
function tail(value, limit = 300) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const trimmed = text.trim()
  return trimmed.length > limit ? `…${trimmed.slice(-limit)}` : trimmed
}

/**
 * Run `sync.py <args>` with the first working launcher.
 * @param {string[]} args - argv passed after the script path.
 * @returns {{ stdout: string, engine: { script: string, dir: string }, launcher: { file: string, args: string[] } }}
 */
function runSync(args) {
  const engine = resolveEngine()
  const { launchers, tried } = pythonLaunchers()
  if (launchers.length === 0) {
    throw new Error(`no python interpreter answered (${tried.join('; ')}); install Python 3 or set DSH_SESSION_CLOUD_HOME`)
  }
  const failures = []
  for (const launcher of launchers) {
    const result = execCapture(launcher.file, [...launcher.args, engine.script, ...args], { cwd: engine.dir, timeout: TIMEOUT_MS })
    const label = `${launcher.file}${launcher.args.length > 0 ? ` ${launcher.args.join(' ')}` : ''}`
    if (result.error === undefined && result.status === 0) {
      return { stdout: result.stdout, engine, launcher }
    }
    const code = /** @type {any} */ (result.error)?.code
    const text = [
      label,
      result.error === undefined ? `exit ${String(result.status)}` : describeError(result.error),
      tail(result.stderr) === '' ? '' : `stderr=${tail(result.stderr)}`,
      tail(result.stdout) === '' ? '' : `stdout=${tail(result.stdout)}`,
    ].filter(part => part !== '').join(' | ')
    failures.push(text)
    // A missing executable falls through to the next launcher; any other
    // failure (timeout, non-zero exit) is the engine's real answer.
    if (code === 'ENOENT') continue
    throw new Error(`sync.py ${args[0] ?? ''} failed: ${text}`)
  }
  throw new Error(`sync.py could not start under any launcher: ${failures.join(' ;; ')}`)
}

/* --------------------------------------------------------------- status I/O */

/**
 * Parse `sync.py status --json` defensively: a launcher banner or a warning
 * line may precede the array, so the payload is sliced from the first `[`.
 * @param {string} stdout - raw process output.
 * @returns {Array<Record<string, any>>} session rows.
 */
function parseStatusJson(stdout) {
  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start < 0 || end < start) {
    throw new Error(`unexpected \`status --json\` output: ${tail(stdout, 400)}`)
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('`status --json` did not return an array')
  return parsed
}

/**
 * Find one session row. Ids arrive with or without the `session-` prefix
 * (subagent sessions never carry it), so both spellings are compared.
 * @param {Array<Record<string, any>>} rows - parsed status rows.
 * @param {string} sessionId - requested id.
 * @returns {Record<string, any> | undefined} the matching row.
 */
function findSession(rows, sessionId) {
  const wanted = new Set([sessionId])
  if (sessionId.startsWith('session-')) wanted.add(sessionId.slice('session-'.length))
  else wanted.add(`session-${sessionId}`)
  return rows.find(row => row !== null && typeof row === 'object' && wanted.has(String(row.session)))
}

/** @param {string} sessionId @returns {boolean} true when the id is safe to hand to argv. */
function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 200
    && /^[A-Za-z0-9._:-]+$/.test(sessionId)
}

/* ------------------------------------------------------------- http helpers */

/**
 * Write one JSON response, tolerating an already-closed socket.
 * @param {import('node:http').ServerResponse} res - response owning its lifecycle.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON-serialisable payload.
 */
function sendJson(res, status, body) {
  let payload
  try {
    payload = JSON.stringify(body)
  } catch (error) {
    log.warn('failed to serialise response', error)
    payload = JSON.stringify({ ok: false, error: 'response serialisation failed' })
  }
  try {
    if (!res.headersSent) {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
    }
    res.end(payload)
  } catch (error) {
    log.warn('failed to write response (client probably gone)', error)
    try { res.destroy?.() } catch { /* already dead */ }
  }
}

/**
 * Collect a request body with a hard cap.
 * @param {import('node:http').IncomingMessage} req - request stream.
 * @returns {Promise<string>} the decoded body.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY) {
        fail(new Error(`request body exceeds ${MAX_BODY} bytes`))
        try { req.destroy() } catch { /* already gone */ }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', fail)
    req.on('aborted', () => fail(new Error('request aborted')))
  })
}

/* ----------------------------------------------------------------- handlers */

/**
 * GET /session-cloud/state?sessionId=<id>
 * @param {URL} url - parsed request URL.
 * @param {import('node:http').ServerResponse} res - response.
 */
function handleState(url, res) {
  const sessionId = (url.searchParams.get('sessionId') ?? '').trim()
  if (sessionId === '') {
    sendJson(res, 400, { ok: false, error: 'missing sessionId query parameter' })
    return
  }
  if (!isValidSessionId(sessionId)) {
    sendJson(res, 400, { ok: false, error: `invalid sessionId: ${sessionId.slice(0, 80)}` })
    return
  }
  const { stdout, engine, launcher } = runSync(['status', '--json'])
  const rows = parseStatusJson(stdout)
  const row = findSession(rows, sessionId)
  sendJson(res, 200, {
    ok: true,
    sessionId,
    found: row !== undefined,
    // An un-indexed session has no recorded mode. Report "unknown" instead of
    // guessing "local": a wrong "仅本机" badge is worse than an honest "⚠ 未知".
    mode: row === undefined ? 'unknown' : (row.mode === 'cloud' ? 'cloud' : 'local'),
    syncedAt: row !== undefined ? (row.syncedAt ?? null) : null,
    size: row !== undefined ? (row.size ?? null) : null,
    modified: row !== undefined ? (row.modified ?? null) : null,
    workspace: row !== undefined ? (row.workspace ?? null) : null,
    sessions: rows.length,
    engine: { script: engine.script, python: `${launcher.file}${launcher.args.length > 0 ? ` ${launcher.args.join(' ')}` : ''}` },
  })
}

/**
 * POST /session-cloud/mode  body `{ sessionId, mode: "cloud"|"local" }`
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleMode(req, res) {
  const raw = await readBody(req)
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    sendJson(res, 400, { ok: false, error: 'body is not valid JSON' })
    return
  }
  if (payload === null || typeof payload !== 'object') {
    sendJson(res, 400, { ok: false, error: 'body must be a JSON object' })
    return
  }
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
  const mode = payload.mode
  if (!isValidSessionId(sessionId)) {
    sendJson(res, 400, { ok: false, error: 'invalid or missing sessionId' })
    return
  }
  if (mode !== 'cloud' && mode !== 'local') {
    sendJson(res, 400, { ok: false, error: 'mode must be "cloud" or "local"' })
    return
  }

  let stdout
  let engine
  let launcher
  try {
    ({ stdout, engine, launcher } = runSync(['mode', '--session', sessionId, '--to', mode]))
  } catch (error) {
    const text = describeError(error)
    // 「本机没有这条会话」是调用方传错了 id，属客户端错误 —— 回 404 而不是 500，
    // 否则监控里会把用户手滑记成服务端故障。
    if (text.includes('没有匹配的会话')) {
      sendJson(res, 404, { ok: false, error: text })
      return
    }
    throw error
  }

  // Re-read the state file through the engine so the reply reports what was
  // actually persisted, not what we asked for.
  let persisted = mode
  try {
    const rows = parseStatusJson(runSync(['status', '--json']).stdout)
    const row = findSession(rows, sessionId)
    if (row !== undefined && (row.mode === 'cloud' || row.mode === 'local')) persisted = row.mode
  } catch (error) {
    log.warn('mode succeeded but the follow-up status read failed', error)
  }

  sendJson(res, 200, {
    ok: true,
    sessionId,
    mode: persisted,
    output: tail(stdout, 300),
    engine: { script: engine.script, python: `${launcher.file}${launcher.args.length > 0 ? ` ${launcher.args.join(' ')}` : ''}` },
    // A switch to cloud is only a promise: the scheduled backup does the push.
    hint: persisted === 'cloud'
      ? '下次自动备份会带上这条会话'
      : '这条会话已切回仅本机，之后的自动备份不会再包含它',
  })
}

/**
 * GET /session-cloud/health — install-time diagnostic (engine + interpreter).
 * @param {import('node:http').ServerResponse} res - response.
 */
function handleHealth(res) {
  const { tried, launchers } = pythonLaunchers()
  let engine = null
  try {
    engine = resolveEngine()
  } catch (error) {
    sendJson(res, 503, { ok: false, error: describeError(error), python: { tried, working: launchers.length } })
    return
  }
  sendJson(res, 200, {
    ok: launchers.length > 0,
    engine: { script: engine.script, dir: engine.dir, exists: existsSync(engine.script) },
    python: { tried, working: launchers.length, launchers: launchers.map(l => `${l.file}${l.args.length > 0 ? ` ${l.args.join(' ')}` : ''}`) },
    pkgDir: PKG_DIR,
  })
}

/**
 * Build the route handler. Exported (through {@link _internal}) so a dry run
 * can drive it with a fake req/res without booting the whole host.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} handler.
 */
function createHandler() {
  return async function sessionCloudHandler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const pathname = url.pathname.replace(/\/+$/, '') || '/'
      const method = (req.method ?? 'GET').toUpperCase()

      if (pathname === ROUTE || pathname === `${ROUTE}/`) {
        sendJson(res, 200, { ok: true, endpoints: [`GET ${ROUTE}/state?sessionId=<id>`, `POST ${ROUTE}/mode`, `GET ${ROUTE}/health`] })
        return
      }
      if (pathname === `${ROUTE}/health`) {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: `${method} not allowed; use GET` })
          return
        }
        handleHealth(res)
        return
      }
      if (pathname === `${ROUTE}/state`) {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: `${method} not allowed; use GET` })
          return
        }
        handleState(url, res)
        return
      }
      if (pathname === `${ROUTE}/mode`) {
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: `${method} not allowed; use POST` })
          return
        }
        await handleMode(req, res)
        return
      }
      sendJson(res, 404, { ok: false, error: `unknown endpoint ${method} ${pathname}` })
    } catch (error) {
      // Single choke point: any engine/interpreter/timeout failure becomes a
      // 500 with the real reason. Nothing escapes into the host fiber.
      log.warn(`request failed: ${req.method ?? '?'} ${req.url ?? '?'}`, error)
      sendJson(res, 500, { ok: false, error: describeError(error) })
    }
  }
}

/* ------------------------------------------------------------------- plugin */

/**
 * Mount the routes. Called by the loader once `webServer` is available.
 * @param {any} ctx - plugin context.
 */
export function apply(ctx) {
  try {
    if (ctx === null || typeof ctx !== 'object') return
    const webServer = ctx.webServer
    if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
      log.warn('webServer service is unavailable — /session-cloud routes were not registered')
      return
    }
    const handler = createHandler()
    const register = () => webServer.register({ kind: 'prefix', path: ROUTE, handler })
    // ctx.effect ties the route to the fiber: unload/reload disposes it, which
    // also keeps a hot restart from tripping the duplicate-route guard.
    if (typeof ctx.effect === 'function') ctx.effect(register, 'dsh-session-cloud: routes')
    else register()
    log.warn(`routes mounted at ${ROUTE} (state/mode/health)`)
  } catch (error) {
    log.warn('failed to mount /session-cloud routes', error)
  }
}

/** Test seam: the same functions the plugin uses, for dry runs. */
export const _internal = {
  ROUTE,
  TIMEOUT_MS,
  createHandler,
  resolveEngine,
  engineCandidates,
  pythonLaunchers,
  runSync,
  parseStatusJson,
  findSession,
  isValidSessionId,
  sendJson,
  readBody,
  handleState,
  handleMode,
  handleHealth,
}
