import { strToU8, zipSync } from "fflate"

const CODEX_KEYS = [
  "access_token",
  "account_id",
  "disabled",
  "email",
  "expired",
  "id_token",
  "last_refresh",
  "refresh_token",
  "type",
] as const

const CLAUDE_REQUIRED_KEYS = [
  "type",
  "access_token",
  "refresh_token",
  "email",
  "expired",
  "last_refresh",
] as const

const CLAUDE_METADATA_KEYS = [
  "account_uuid",
  "org_uuid",
  "email_address",
  "token_type",
  "scope",
  "expires_at",
  "expires_in",
  "base_rpm",
  "passive_usage_7d_reset",
  "passive_usage_7d_utilization",
  "passive_usage_sampled_at",
  "rpm_sticky_buffer",
  "rpm_strategy",
  "session_window_utilization",
  "user_msg_queue_mode",
  "window_cost_limit",
  "window_cost_sticky_reserve",
] as const

const PROVIDER_CHOICES = new Set(["auto", "codex", "claude"])
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const DEFAULT_OUTPUT_DIR = "cpa-import"
const DEFAULT_CLI_PROXY_URL = "http://127.0.0.1:8317"

type JsonRecord = Record<string, unknown>

export type Provider = "codex" | "claude" | string

export type PreviewItem = {
  index: number
  provider: Provider
  name: string
  platform?: string
  type?: string
}

export type PreviewResponse = {
  ok: boolean
  filename: string
  count: number
  providerCounts: Record<string, number>
  items: PreviewItem[]
}

export type SummaryItem = {
  index: number
  provider: Provider
  detected_provider: Provider
  email: string
  filename: string
  path: string
  warnings?: string[]
}

export type ConvertSummary = {
  source?: string
  output_dir: string
  provider?: string
  provider_counts: Record<string, number>
  written_count: number
  files?: string[]
  items: SummaryItem[]
  warnings?: string[]
  errors?: string[]
  cli_proxy_import?: {
    ok: boolean
    uploaded?: number
    url?: string
    files?: string[]
    response?: unknown
    error?: string
  }
}

export type GeneratedArtifact = {
  name: string
  path: string
  contents: string
}

export type BrowserConvertResult = {
  summary: ConvertSummary
  artifacts: GeneratedArtifact[]
  accountArtifacts: GeneratedArtifact[]
}

export class ConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConversionError"
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function cleanString(value: unknown): string {
  if (value == null) {
    return ""
  }
  return String(value).trim()
}

function firstNonEmpty(...values: unknown[]): unknown {
  for (const value of values) {
    if (value == null) {
      continue
    }
    if (typeof value === "string" && !value.trim()) {
      continue
    }
    return value
  }
  return null
}

function parseExportedAt(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value.replace("Z", "+00:00"))
  if (Number.isNaN(parsed)) {
    return null
  }
  return Math.floor(parsed / 1000)
}

function parseTimezoneOffset(offset: string): number {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim())
  if (!match) {
    throw new ConversionError("时区格式错误，请使用类似 +08:00 或 -0500")
  }
  const [, sign, hours, minutes] = match
  const totalMinutes = Number(hours) * 60 + Number(minutes)
  return sign === "-" ? -totalMinutes : totalMinutes
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function formatDateWithOffset(date: Date, offsetMinutes: number): string {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000)
  const sign = offsetMinutes >= 0 ? "+" : "-"
  const absoluteOffset = Math.abs(offsetMinutes)
  const offsetHours = Math.floor(absoluteOffset / 60)
  const offsetMins = absoluteOffset % 60
  return [
    shifted.getUTCFullYear(),
    "-",
    pad2(shifted.getUTCMonth() + 1),
    "-",
    pad2(shifted.getUTCDate()),
    "T",
    pad2(shifted.getUTCHours()),
    ":",
    pad2(shifted.getUTCMinutes()),
    ":",
    pad2(shifted.getUTCSeconds()),
    sign,
    pad2(offsetHours),
    ":",
    pad2(offsetMins),
  ].join("")
}

function parseNaiveIso(value: string, offsetMinutes: number): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?)?$/.exec(
      value
    )
  if (!match) {
    return null
  }
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match
  const utcMs =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ) - offsetMinutes * 60_000
  return formatDateWithOffset(new Date(utcMs), offsetMinutes)
}

function formatFromNumberish(value: number, offsetMinutes: number): string {
  let seconds = value
  if (Math.abs(seconds) > 10_000_000_000) {
    seconds = seconds / 1000
  }
  return formatDateWithOffset(new Date(seconds * 1000), offsetMinutes)
}

function isoFromTs(value: unknown, offsetMinutes: number): string {
  if (value == null || value === "") {
    return ""
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) {
      return ""
    }
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return formatFromNumberish(Number(trimmed), offsetMinutes)
    }
    const hasExplicitZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)
    const parsed = new Date(trimmed.replace("Z", "+00:00"))
    if (!Number.isNaN(parsed.getTime()) && hasExplicitZone) {
      return formatDateWithOffset(parsed, offsetMinutes)
    }
    const naive = parseNaiveIso(trimmed, offsetMinutes)
    if (naive) {
      return naive
    }
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateWithOffset(parsed, offsetMinutes)
    }
    throw new ConversionError(`时间格式无法识别：${JSON.stringify(value)}`)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ConversionError(`时间格式无法识别：${JSON.stringify(value)}`)
    }
    return formatFromNumberish(value, offsetMinutes)
  }
  throw new ConversionError(`时间格式无法识别：${JSON.stringify(value)}`)
}

function base64UrlDecodeJson(part: string): JsonRecord {
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const text = new TextDecoder().decode(bytes)
  const parsed = JSON.parse(text)
  return asRecord(parsed)
}

function jwtPayload(token: unknown): JsonRecord {
  const text = cleanString(token)
  if (!text || text.split(".").length < 3) {
    return {}
  }
  try {
    return base64UrlDecodeJson(text.split(".")[1] ?? "")
  } catch {
    return {}
  }
}

function safeFilename(value: string): string {
  const cleaned = value.replace(INVALID_FILENAME_CHARS, "_").trim().replace(/^\.+|\.+$/g, "")
  return cleaned || "unknown"
}

function normalizeOutputDir(value: string): string {
  const normalized = (value || DEFAULT_OUTPUT_DIR).trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  return normalized || DEFAULT_OUTPUT_DIR
}

function joinOutputPath(outputDir: string, filename: string): string {
  return `${normalizeOutputDir(outputDir)}/${filename}`
}

function extractAccounts(raw: unknown): [JsonRecord[], number | null] {
  if (isRecord(raw)) {
    const exportedAtTs = parseExportedAt(cleanString(raw.exported_at))
    if (Array.isArray(raw.accounts)) {
      return [raw.accounts.filter(isRecord), exportedAtTs]
    }

    const looksLikeCodex = CODEX_KEYS.every((key) => key in raw)
    const looksLikeClaude = CLAUDE_REQUIRED_KEYS.every((key) => key in raw)
    if (looksLikeCodex || looksLikeClaude) {
      throw new ConversionError("输入看起来已经是 CLIProxyAPI/CPA 单账号 JSON，不是 Sub2API 导出。")
    }
  }

  if (Array.isArray(raw)) {
    return [raw.filter(isRecord), null]
  }

  throw new ConversionError("不支持的输入结构：需要包含 accounts 数组的 Sub2API JSON。")
}

export function parseExportJson(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new ConversionError(
      `导出 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function inferProvider(account: JsonRecord): Provider {
  const credentials = asRecord(account.credentials)
  const platform = cleanString(account.platform).toLowerCase()
  const accountType = cleanString(account.type).toLowerCase()
  const accessToken = cleanString(credentials.access_token)
  const refreshToken = cleanString(credentials.refresh_token)
  const scope = cleanString(credentials.scope).toLowerCase()

  if (
    platform === "anthropic" ||
    platform === "claude" ||
    platform.includes("anthropic") ||
    platform.includes("claude") ||
    accessToken.startsWith("sk-ant-") ||
    refreshToken.startsWith("sk-ant-") ||
    ["account_uuid", "org_uuid", "email_address"].some((key) => key in credentials) ||
    scope.includes("anthropic")
  ) {
    return "claude"
  }

  if (
    platform === "openai" ||
    platform === "chatgpt" ||
    platform === "codex" ||
    accountType === "oauth" ||
    accountType === "openai" ||
    accountType === "codex" ||
    accessToken.split(".").length >= 3 ||
    ["chatgpt_account_id", "chatgpt_user_id", "organization_id"].some((key) => key in credentials)
  ) {
    return "codex"
  }

  return "codex"
}

export function accountDisplayName(account: JsonRecord, index: number): string {
  const credentials = asRecord(account.credentials)
  const extra = asRecord(account.extra)
  return cleanString(
    firstNonEmpty(
      credentials.email,
      credentials.email_address,
      extra.email,
      extra.email_address,
      account.name,
      `account-${index}`
    )
  )
}

function accountToCodex(account: JsonRecord, index: number, exportedAtTs: number | null, offsetMinutes: number) {
  const warnings: string[] = []
  const credentials = asRecord(account.credentials)
  const extra = asRecord(account.extra)

  const accessToken = cleanString(credentials.access_token)
  let refreshToken = cleanString(credentials.refresh_token)
  let idToken = cleanString(credentials.id_token)

  const payload = jwtPayload(accessToken)
  const auth = asRecord(payload["https://api.openai.com/auth"])
  const profile = asRecord(payload["https://api.openai.com/profile"])

  const email = cleanString(
    firstNonEmpty(extra.email, credentials.email, profile.email, account.name, `account-${index}`)
  )

  const accountId = cleanString(
    firstNonEmpty(credentials.chatgpt_account_id, auth.chatgpt_account_id)
  )

  const expiresAt = firstNonEmpty(credentials.expires_at, payload.exp)
  let issuedAt = firstNonEmpty(payload.iat, credentials.issued_at)
  if (!issuedAt && expiresAt && credentials.expires_in != null) {
    const expiresValue = Number(expiresAt)
    const expiresInValue = Number(credentials.expires_in)
    if (Number.isFinite(expiresValue) && Number.isFinite(expiresInValue)) {
      issuedAt = expiresValue - expiresInValue
    }
  }
  if (!issuedAt) {
    issuedAt = exportedAtTs
  }

  const plan = cleanString(firstNonEmpty(auth.chatgpt_plan_type, extra.plan, "free"))

  if (inferProvider(account) !== "codex") {
    warnings.push(`${email}: 当前账号不像 Codex/OpenAI，可能是强制 provider 导致`)
  }
  if (!accessToken) {
    warnings.push(`${email}: 缺少 access_token`)
  }
  if (!refreshToken) {
    warnings.push(`${email}: 缺少 refresh_token，已用 access_token 占位`)
    refreshToken = accessToken
  }
  if (!idToken) {
    warnings.push(`${email}: 缺少 id_token，已用 access_token 占位`)
    idToken = accessToken
  }
  if (refreshToken === accessToken) {
    warnings.push(`${email}: refresh_token 与 access_token 相同，可能不能自动刷新`)
  }
  if (!accountId) {
    warnings.push(`${email}: 缺少 account_id`)
  }
  if (!expiresAt) {
    warnings.push(`${email}: 缺少过期时间`)
  }

  const value = {
    access_token: accessToken,
    account_id: accountId,
    disabled: Boolean(account.disabled ?? false),
    email,
    expired: isoFromTs(expiresAt, offsetMinutes),
    id_token: idToken,
    last_refresh: isoFromTs(issuedAt, offsetMinutes),
    refresh_token: refreshToken,
    type: "codex",
  }

  const filename = `codex-${safeFilename(email)}-${safeFilename(plan)}.json`
  return { value, filename, warnings, email }
}

function accountToClaude(account: JsonRecord, index: number, exportedAtTs: number | null, offsetMinutes: number) {
  const warnings: string[] = []
  const credentials = asRecord(account.credentials)
  const extra = asRecord(account.extra)

  const accessToken = cleanString(credentials.access_token)
  const refreshToken = cleanString(credentials.refresh_token)
  const idToken = cleanString(credentials.id_token)
  const email = cleanString(
    firstNonEmpty(
      credentials.email_address,
      credentials.email,
      extra.email_address,
      extra.email,
      account.name,
      `claude-account-${index}`
    )
  )

  const expiresAt = firstNonEmpty(credentials.expires_at, extra.expires_at)
  let issuedAt = firstNonEmpty(
    credentials.issued_at,
    extra.passive_usage_sampled_at,
    account.updated_at,
    exportedAtTs
  )
  if (!issuedAt && expiresAt && credentials.expires_in != null) {
    const expiresValue = Number(expiresAt)
    const expiresInValue = Number(credentials.expires_in)
    if (Number.isFinite(expiresValue) && Number.isFinite(expiresInValue)) {
      issuedAt = expiresValue - expiresInValue
    }
  }

  const scope = cleanString(credentials.scope)
  const scopeItems = new Set(scope.replace(/,/g, " ").split(/\s+/).filter(Boolean))

  if (inferProvider(account) !== "claude") {
    warnings.push(`${email}: 当前账号不像 Claude/Anthropic，可能是强制 provider 导致`)
  }
  if (!accessToken) {
    warnings.push(`${email}: 缺少 access_token`)
  }
  if (!refreshToken) {
    warnings.push(`${email}: 缺少 refresh_token`)
  }
  if (accessToken && !accessToken.startsWith("sk-ant-")) {
    warnings.push(`${email}: access_token 不是常见 sk-ant-* 形式，请确认来源`)
  }
  if (!expiresAt) {
    warnings.push(`${email}: 缺少过期时间`)
  }
  if (scope && !scopeItems.has("user:profile")) {
    warnings.push(`${email}: Claude token 缺少 user:profile，CLIProxyAPI 额度/资料页可能失败；推理通常不受影响`)
  }

  const value: JsonRecord = {
    type: "claude",
    access_token: accessToken,
    refresh_token: refreshToken,
    email,
    expired: isoFromTs(expiresAt, offsetMinutes),
    last_refresh: isoFromTs(issuedAt, offsetMinutes),
    disabled: Boolean(account.disabled ?? false),
    label: email,
    source: "sub2api-account-export",
  }

  if (idToken) {
    value.id_token = idToken
  }
  if (account.notes != null) {
    value.note = cleanString(account.notes)
  }
  if (account.priority != null) {
    value.priority = account.priority
  }

  for (const key of CLAUDE_METADATA_KEYS) {
    const nextValue = firstNonEmpty(credentials[key], extra[key])
    if (nextValue != null) {
      value[key] = nextValue
    }
  }

  if (!value.email_address && email) {
    value.email_address = email
  }

  const filename = `claude-${safeFilename(email)}.json`
  return { value, filename, warnings, email }
}

function validateCodexObject(value: JsonRecord, filename: string): string[] {
  const errors: string[] = []
  const keys = Object.keys(value)
  if (
    keys.length !== CODEX_KEYS.length ||
    keys.some((key, index) => key !== CODEX_KEYS[index])
  ) {
    errors.push(`${filename}: 字段顺序或字段集合不匹配 CPA/Codex 模板`)
  }
  for (const key of CODEX_KEYS) {
    if (!(key in value)) {
      errors.push(`${filename}: 缺少字段 ${key}`)
    }
  }
  for (const key of [
    "access_token",
    "account_id",
    "email",
    "expired",
    "id_token",
    "last_refresh",
    "refresh_token",
    "type",
  ]) {
    if (!value[key]) {
      errors.push(`${filename}: 字段 ${key} 为空`)
    }
  }
  if (value.type !== "codex") {
    errors.push(`${filename}: type 不是 codex`)
  }
  return errors
}

function validateClaudeObject(value: JsonRecord, filename: string): string[] {
  const errors: string[] = []
  for (const key of CLAUDE_REQUIRED_KEYS) {
    if (!(key in value)) {
      errors.push(`${filename}: 缺少字段 ${key}`)
    } else if (!value[key]) {
      errors.push(`${filename}: 字段 ${key} 为空`)
    }
  }
  if (value.type !== "claude") {
    errors.push(`${filename}: type 不是 claude`)
  }
  return errors
}

function validateImportObject(value: JsonRecord, filename: string, provider: string): string[] {
  if (provider === "codex") {
    return validateCodexObject(value, filename)
  }
  if (provider === "claude") {
    return validateClaudeObject(value, filename)
  }
  return [`${filename}: 未知 provider ${provider}`]
}

export function previewExport(raw: unknown, filename: string): PreviewResponse {
  const [accounts] = extractAccounts(raw)
  const items: PreviewItem[] = []
  const providerCounts: Record<string, number> = { codex: 0, claude: 0 }

  accounts.forEach((account, index) => {
    const provider = inferProvider(account)
    providerCounts[provider] = (providerCounts[provider] || 0) + 1
    items.push({
      index: index + 1,
      provider,
      name: accountDisplayName(account, index + 1),
      platform: cleanString(account.platform) || undefined,
      type: cleanString(account.type) || undefined,
    })
  })

  return {
    ok: true,
    filename,
    count: items.length,
    providerCounts,
    items,
  }
}

export function convertExportBrowser(
  raw: unknown,
  options: {
    outputDir?: string
    provider?: string
    tzOffset?: string
    inputLabel?: string
    sourcePath?: string
    writeSummary?: boolean
  }
): BrowserConvertResult {
  const provider = options.provider || "auto"
  if (!PROVIDER_CHOICES.has(provider)) {
    throw new ConversionError(`provider 必须是 ${Array.from(PROVIDER_CHOICES).join(", ")}`)
  }

  const offsetMinutes = parseTimezoneOffset(options.tzOffset || "+08:00")
  const outputDir = normalizeOutputDir(options.outputDir || DEFAULT_OUTPUT_DIR)
  const [accounts, exportedAtTs] = extractAccounts(raw)
  if (!accounts.length) {
    throw new ConversionError("没有找到可转换账号。")
  }

  const accountArtifacts: GeneratedArtifact[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const items: SummaryItem[] = []
  const providerCounts: Record<string, number> = {}

  accounts.forEach((account, index) => {
    const detectedProvider = inferProvider(account)
    const targetProvider = provider === "auto" ? detectedProvider : provider
    providerCounts[targetProvider] = (providerCounts[targetProvider] || 0) + 1

    let result:
      | ReturnType<typeof accountToCodex>
      | ReturnType<typeof accountToClaude>

    if (targetProvider === "claude") {
      result = accountToClaude(account, index + 1, exportedAtTs, offsetMinutes)
    } else {
      result = accountToCodex(account, index + 1, exportedAtTs, offsetMinutes)
    }

    warnings.push(...result.warnings)

    const validationErrors = validateImportObject(
      result.value,
      result.filename,
      targetProvider
    )
    errors.push(...validationErrors)

    const contents = `${JSON.stringify(result.value, null, 2)}\n`
    const path = joinOutputPath(outputDir, result.filename)
    accountArtifacts.push({
      name: result.filename,
      path,
      contents,
    })

    items.push({
      index: index + 1,
      provider: targetProvider,
      detected_provider: detectedProvider,
      email: result.email,
      filename: result.filename,
      path,
      warnings: result.warnings,
    })
  })

  const summary: ConvertSummary = {
    source: options.sourcePath || options.inputLabel || "",
    output_dir: outputDir,
    provider,
    provider_counts: providerCounts,
    written_count: accountArtifacts.length,
    files: accountArtifacts.map((artifact) => artifact.name),
    items,
    warnings,
    errors,
  }

  const artifacts = [...accountArtifacts]
  if (options.writeSummary ?? true) {
    artifacts.push({
      name: "conversion-summary.json",
      path: joinOutputPath(outputDir, "conversion-summary.json"),
      contents: `${JSON.stringify(summary, null, 2)}\n`,
    })
  }

  return { summary, artifacts, accountArtifacts }
}

export function normalizeCliProxyUrl(value: string): string {
  const url = (value || DEFAULT_CLI_PROXY_URL).trim().replace(/\/+$/, "")
  try {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.host) {
      throw new Error("invalid url")
    }
    return url
  } catch {
    throw new ConversionError("CLIProxyAPI 地址格式不正确，例如：http://127.0.0.1:8317")
  }
}

export async function importFilesToCliProxyApiBrowser(
  files: GeneratedArtifact[],
  options: {
    cliProxyUrl?: string
    managementKey: string
  }
) {
  if (!files.length) {
    return { ok: true, uploaded: 0, files: [], url: normalizeCliProxyUrl(options.cliProxyUrl || "") }
  }
  if (!options.managementKey.trim()) {
    throw new ConversionError("导入到 CLIProxyAPI 需要 Management Key")
  }

  const baseUrl = normalizeCliProxyUrl(options.cliProxyUrl || DEFAULT_CLI_PROXY_URL)
  const endpoint = `${baseUrl}/v0/management/auth-files`
  const formData = new FormData()
  for (const file of files) {
    formData.append("file", new File([file.contents], file.name, { type: "application/json" }))
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.managementKey.trim()}`,
        Accept: "application/json",
      },
      body: formData,
    })
  } catch (error) {
    throw new ConversionError(
      `连接 CLIProxyAPI 失败：浏览器无法直接访问目标地址，可能是跨域(CORS)或网络问题。${
        error instanceof Error && error.message ? ` ${error.message}` : ""
      }`.trim()
    )
  }

  const rawBody = await response.text()
  let parsedBody: unknown = {}
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody)
    } catch {
      parsedBody = { raw: rawBody.slice(0, 500) }
    }
  }

  if (!response.ok) {
    let message = `CLIProxyAPI 返回 HTTP ${response.status}。`
    if (response.status === 401) {
      message = "CLIProxyAPI 返回 401：Management Key 不正确或未填写。"
    } else if (response.status === 404) {
      message = "CLIProxyAPI 返回 404：请确认地址是管理面板所在地址，例如 http://127.0.0.1:8317。"
    }
    throw new ConversionError(`${message} ${rawBody.slice(0, 500)}`.trim())
  }

  return {
    ok: true,
    uploaded: files.length,
    files: files.map((file) => file.name),
    url: baseUrl,
    response: parsedBody,
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export function buildPackageFilename(inputFilename: string): string {
  const baseName = cleanString(inputFilename).replace(/\.[^.]+$/, "") || "sub2-cpa"
  return `${safeFilename(baseName)}-cpa.zip`
}

export function downloadArtifactsAsZip(artifacts: GeneratedArtifact[], filename: string) {
  if (!artifacts.length) {
    throw new ConversionError("没有可下载的文件，请先开始转换。")
  }
  const archive = zipSync(
    Object.fromEntries(artifacts.map((artifact) => [artifact.path, strToU8(artifact.contents)])),
    { level: 6 }
  )
  triggerDownload(new Blob([archive], { type: "application/zip" }), filename)
}
