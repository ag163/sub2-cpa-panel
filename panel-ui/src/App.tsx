import { useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  Bot,
  Box,
  CheckCircle2,
  Download,
  FileJson,
  KeyRound,
  Loader2,
  RefreshCw,
  Upload,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  ConversionError,
  type ConvertSummary,
  convertExportBrowser,
  downloadArtifactsAsZip,
  buildPackageFilename,
  importFilesToCliProxyApiBrowser,
  normalizeCliProxyUrl,
  parseExportJson,
  previewExport,
  type PreviewResponse,
  type Provider,
  type GeneratedArtifact,
} from "@/lib/converter"

const DEFAULT_OUTPUT_DIR = "cpa-import"

function isLocalOrPrivateHost(hostname: string) {
  const normalized = hostname.toLowerCase()
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") {
    return true
  }
  if (/^10\./.test(normalized)) {
    return true
  }
  if (/^192\.168\./.test(normalized)) {
    return true
  }
  const match172 = /^172\.(\d{1,3})\./.exec(normalized)
  if (match172) {
    const second = Number(match172[1])
    if (second >= 16 && second <= 31) {
      return true
    }
  }
  return false
}

async function toErrorMessage(error: unknown): Promise<string> {
  if (error instanceof ConversionError || error instanceof Error) {
    return error.message
  }
  return String(error)
}

function ProviderPill({ provider }: { provider: Provider }) {
  const tone = provider === "claude" ? "claude" : provider === "codex" ? "codex" : "neutral"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1",
        tone === "codex" && "bg-blue-50 text-blue-700 ring-blue-200",
        tone === "claude" && "bg-amber-50 text-amber-700 ring-amber-200",
        tone === "neutral" && "bg-slate-100 text-slate-600 ring-slate-200"
      )}
    >
      {provider}
    </span>
  )
}

function FieldLabel({ children }: { children: string }) {
  return <span className="text-xs font-semibold text-slate-900">{children}</span>
}

function NativeSelect({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <select
      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/20"
      onChange={(event) => onChange(event.currentTarget.value)}
      value={value}
    >
      {children}
    </select>
  )
}

function StatusCallout({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "success" | "error"
  children: React.ReactNode
}) {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border p-3 text-sm leading-6",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        tone === "error" && "border-red-200 bg-red-50 text-red-700"
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function EmptyResult() {
  return (
    <div className="grid min-h-56 place-items-center rounded-xl border bg-gradient-to-b from-white to-slate-50 p-6 text-center text-slate-500">
      <div>
        <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
          <Box className="size-7" />
        </div>
        <div className="text-base font-semibold text-slate-950">暂无结果</div>
        <div className="mt-1 text-sm">请先选择文件并开始转换</div>
      </div>
    </div>
  )
}

export default function App() {
  const [filename, setFilename] = useState("")
  const [content, setContent] = useState("")
  const [outputDir, setOutputDir] = useState(DEFAULT_OUTPUT_DIR)
  const [tzOffset, setTzOffset] = useState("+08:00")
  const [provider, setProvider] = useState("auto")
  const [writeSummary, setWriteSummary] = useState("true")
  const [cliProxyUrl, setCliProxyUrl] = useState("")
  const [managementKey, setManagementKey] = useState("")
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [summary, setSummary] = useState<ConvertSummary | null>(null)
  const [artifacts, setArtifacts] = useState<GeneratedArtifact[]>([])
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState<"convert" | "import" | "">("")

  const canConvert = Boolean(content) && !busy
  const canDownload = Boolean(artifacts.length) && !busy

  const counts = useMemo(
    () => ({
      all: preview?.count || 0,
      codex: preview?.providerCounts?.codex || 0,
      claude: preview?.providerCounts?.claude || 0,
    }),
    [preview]
  )

  async function previewContent(nextFilename: string, nextContent: string) {
    try {
      setMessage("")
      setSummary(null)
      setArtifacts([])
      const raw = parseExportJson(nextContent)
      setPreview(previewExport(raw, nextFilename))
    } catch (error) {
      setPreview(null)
      setSummary(null)
      setArtifacts([])
      setMessage(await toErrorMessage(error))
    }
  }

  async function handleFile(file?: File) {
    if (!file) return
    const text = await file.text()
    setFilename(file.name)
    setContent(text)
    await previewContent(file.name, text)
  }

  function downloadPackage(nextArtifacts: GeneratedArtifact[] = artifacts) {
    downloadArtifactsAsZip(nextArtifacts, buildPackageFilename(filename))
  }

  async function convert(importAfter = false) {
    if (!content) return
    if (importAfter && !managementKey.trim()) {
      setMessage("直连导入到 CLIProxyAPI 需要填写 Management Key。")
      return
    }
    setBusy(importAfter ? "import" : "convert")
    setMessage("")
    try {
      const raw = parseExportJson(content)
      const result = convertExportBrowser(raw, {
        outputDir,
        provider,
        tzOffset: tzOffset || "+08:00",
        inputLabel: filename || "uploaded.json",
        writeSummary: writeSummary === "true",
      })

      const nextSummary = result.summary
      setSummary(nextSummary)
      setArtifacts(result.artifacts)

      if (importAfter) {
        const baseUrl = normalizeCliProxyUrl(cliProxyUrl)
        const parsed = new URL(baseUrl)
        if (window.location.protocol === "https:" && parsed.protocol !== "https:") {
          throw new ConversionError(
            "当前托管页面运行在 HTTPS 下，浏览器会拦截访问 HTTP 的 CLIProxyAPI。请改成 HTTPS 公网地址，或先下载 ZIP 手动导入。"
          )
        }
        if (isLocalOrPrivateHost(parsed.hostname)) {
          throw new ConversionError(
            "线上托管版无法直接访问你本机/局域网的 CLIProxyAPI。请先下载 ZIP 手动导入，或提供一个已开启 CORS 的公网 HTTPS CLIProxyAPI 地址。"
          )
        }

        try {
          nextSummary.cli_proxy_import = await importFilesToCliProxyApiBrowser(result.accountArtifacts, {
            cliProxyUrl: baseUrl,
            managementKey,
          })
        } catch (error) {
          nextSummary.cli_proxy_import = {
            ok: false,
            error: await toErrorMessage(error),
            url: baseUrl,
          }
        }
        setSummary({ ...nextSummary })
      }
    } catch (error) {
      setMessage(await toErrorMessage(error))
    } finally {
      setBusy("")
    }
  }

  function restoreDefaults() {
    setOutputDir(DEFAULT_OUTPUT_DIR)
    setTzOffset("+08:00")
    setProvider("auto")
    setWriteSummary("true")
    setCliProxyUrl("")
    setManagementKey("")
    setMessage("")
  }

  return (
    <main className="min-h-screen">
      <section className="mx-auto min-w-0 max-w-[1440px] px-5 py-5 max-md:px-3">
        <header className="mb-4 flex items-start justify-between gap-4 max-lg:flex-col">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Sub2 → CLIProxyAPI</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="h-10 rounded-xl" disabled={!canDownload} onClick={() => downloadPackage()} variant="outline">
              <Download className="size-4" /> 下载 ZIP
            </Button>
            <Button className="h-10 rounded-xl" onClick={restoreDefaults} variant="outline">
              <RefreshCw className="size-4" /> 恢复默认值
            </Button>
          </div>
        </header>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
          <div className="grid gap-4">
            <Card className="shadow-xl shadow-slate-900/5">
              <CardHeader>
                <CardTitle className="text-xl font-bold">1. 选择导出文件</CardTitle>
                <CardDescription>选择 Sub2API 的 account export JSON。整个转换都在浏览器本地完成，不会上传到本站。</CardDescription>
              </CardHeader>
              <CardContent>
                <label
                  className="grid min-h-28 cursor-pointer place-items-center rounded-2xl border border-dashed border-blue-300 bg-gradient-to-b from-blue-50/80 to-white p-5 text-center transition hover:border-blue-600 hover:ring-3 hover:ring-blue-600/10"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    void handleFile(event.dataTransfer.files[0])
                  }}
                >
                  <input
                    accept="application/json,.json"
                    className="sr-only"
                    onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
                    type="file"
                  />
                  <div>
                    <FileJson className="mx-auto mb-2 size-7 text-blue-600" />
                    <div className="text-base font-bold text-slate-950">{filename || "点击选择 sub2api-account-*.json"}</div>
                    <div className="mt-2 text-sm text-slate-500">也可以直接拖到这里。转换完成后会生成可下载 ZIP。</div>
                  </div>
                </label>
              </CardContent>
            </Card>

            <Card className="shadow-xl shadow-slate-900/5">
              <CardHeader>
                <CardTitle className="text-xl font-bold">2. 转换设置</CardTitle>
                <CardDescription>线上托管版不再写本地文件夹；会把生成结果打包成 ZIP 下载。</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_192px]">
                  <label className="grid gap-2">
                    <FieldLabel>压缩包内目录名</FieldLabel>
                    <Input className="h-10 rounded-xl" onChange={(event) => setOutputDir(event.currentTarget.value)} value={outputDir} />
                  </label>
                  <label className="grid gap-2">
                    <FieldLabel>时区</FieldLabel>
                    <Input className="h-10 rounded-xl" onChange={(event) => setTzOffset(event.currentTarget.value)} value={tzOffset} />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <FieldLabel>转换类型</FieldLabel>
                    <NativeSelect onChange={setProvider} value={provider}>
                      <option value="auto">自动识别（推荐）</option>
                      <option value="codex">强制 Codex/OpenAI</option>
                      <option value="claude">强制 Claude/Anthropic</option>
                    </NativeSelect>
                  </label>
                  <label className="grid gap-2">
                    <FieldLabel>摘要</FieldLabel>
                    <NativeSelect onChange={setWriteSummary} value={writeSummary}>
                      <option value="true">生成 summary</option>
                      <option value="false">不生成</option>
                    </NativeSelect>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <FieldLabel>公网 CLIProxyAPI 地址</FieldLabel>
                    <Input
                      className="h-10 rounded-xl"
                      onChange={(event) => setCliProxyUrl(event.currentTarget.value)}
                      placeholder="仅直连公网 HTTPS 地址时填写"
                      value={cliProxyUrl}
                    />
                  </label>
                  <label className="grid gap-2">
                    <FieldLabel>Management Key</FieldLabel>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        className="h-10 rounded-xl pl-9"
                        onChange={(event) => setManagementKey(event.currentTarget.value)}
                        placeholder="尝试公网直连导入时填写"
                        type="password"
                        value={managementKey}
                      />
                    </div>
                  </label>
                </div>

                <StatusCallout>
                  托管版默认流程是“浏览器本地转换 → 下载 ZIP”。如果你的 CLIProxyAPI 只是本机 `127.0.0.1` 或局域网地址，浏览器会拦截公网页面直连，请下载后手动导入。
                </StatusCallout>

                {message ? <StatusCallout tone="error">{message}</StatusCallout> : null}

                <div className="grid gap-2 sm:grid-cols-[minmax(160px,240px)_minmax(220px,1fr)_auto]">
                  <Button className="h-12 rounded-xl text-base" disabled={!canConvert} onClick={() => void convert(false)}>
                    {busy === "convert" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    开始转换
                  </Button>
                  <Button className="h-12 rounded-xl text-base" disabled={!canConvert} onClick={() => void convert(true)} variant="outline">
                    {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    尝试直连导入
                  </Button>
                  <Button className="h-12 rounded-xl" disabled={!canDownload} onClick={() => downloadPackage()} variant="outline">
                    下载 ZIP
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4">
            <Card className="shadow-xl shadow-slate-900/5">
              <CardHeader>
                <CardTitle className="text-xl font-bold">预览</CardTitle>
                <CardDescription>{preview ? `已读取：${preview.filename}` : "先选择一个导出文件。"}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid grid-cols-[42px_1fr] items-center gap-3 rounded-2xl border bg-gradient-to-b from-white to-slate-50 p-3">
                    <span className="grid size-10 place-items-center rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-200"><Users className="size-5" /></span>
                    <div><b className="block text-2xl leading-none">{counts.all}</b><span className="text-xs font-semibold text-slate-500">账号数</span></div>
                  </div>
                  <div className="grid grid-cols-[42px_1fr] items-center gap-3 rounded-2xl border bg-gradient-to-b from-white to-slate-50 p-3">
                    <span className="grid size-10 place-items-center rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-200"><Bot className="size-5" /></span>
                    <div><b className="block text-2xl leading-none">{counts.codex}</b><span className="text-xs font-semibold text-slate-500">Codex</span></div>
                  </div>
                  <div className="grid grid-cols-[42px_1fr] items-center gap-3 rounded-2xl border bg-gradient-to-b from-white to-slate-50 p-3">
                    <span className="grid size-10 place-items-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200">AI</span>
                    <div><b className="block text-2xl leading-none">{counts.claude}</b><span className="text-xs font-semibold text-slate-500">Claude</span></div>
                  </div>
                </div>

                <div className="mt-4 grid gap-2">
                  {preview?.items?.length ? (
                    preview.items.map((item) => (
                      <div className="grid gap-1 rounded-2xl border bg-white p-3 shadow-sm" key={`${item.index}-${item.name}`}>
                        <div className="flex items-center justify-between gap-3">
                          <strong className="truncate text-sm text-slate-950">{item.name}</strong>
                          <ProviderPill provider={item.provider} />
                        </div>
                        <div className="text-xs text-slate-500">#{item.index} · {item.platform || "unknown"} · {item.type || "unknown"}</div>
                      </div>
                    ))
                  ) : (
                    <div className="grid min-h-32 place-items-center rounded-2xl border border-dashed bg-slate-50 p-6 text-center text-sm text-slate-500">
                      暂无预览数据<br />请选择 Sub2API 导出的 JSON 文件以查看预览
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xl shadow-slate-900/5">
              <CardHeader>
                <CardTitle className="text-xl font-bold">结果</CardTitle>
                <CardDescription>{summary ? `已生成 ${summary.written_count} 个文件` : "转换后会显示文件名、警告，并可下载 ZIP。"}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {!summary ? <EmptyResult /> : null}

                {summary?.cli_proxy_import ? (
                  <StatusCallout tone={summary.cli_proxy_import.ok ? "success" : "error"}>
                    {summary.cli_proxy_import.ok
                      ? `已直连导入到 CLIProxyAPI：${summary.cli_proxy_import.uploaded || 0} 个文件 · ${summary.cli_proxy_import.url || ""}`
                      : `直连导入失败：${summary.cli_proxy_import.error || "未知错误"}`}
                  </StatusCallout>
                ) : null}

                {summary?.warnings?.length ? (
                  <StatusCallout>共有 {summary.warnings.length} 条警告；Claude 缺少 user:profile 时，额度页失败但推理通常可用。</StatusCallout>
                ) : null}

                {summary?.errors?.length ? <StatusCallout tone="error">{summary.errors.join("；")}</StatusCallout> : null}

                {summary?.items?.map((item) => (
                  <div className="grid gap-2 rounded-2xl border bg-white p-3 shadow-sm" key={item.path}>
                    <div className="flex items-center justify-between gap-3">
                      <ProviderPill provider={item.provider} />
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">已生成</span>
                    </div>
                    <div className="break-all font-mono text-xs text-slate-900">{item.filename}</div>
                    <div className="break-all text-xs text-slate-500">{item.path}</div>
                    {item.warnings?.map((warning) => <StatusCallout key={warning}>{warning}</StatusCallout>)}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  )
}
