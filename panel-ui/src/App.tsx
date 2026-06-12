import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  Bot,
  Box,
  CheckCircle2,
  FileJson,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCw,
  Upload,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Provider = "codex" | "claude" | string

type PreviewItem = {
  index: number
  provider: Provider
  name: string
  platform?: string
  type?: string
}

type PreviewResponse = {
  ok: boolean
  filename: string
  count: number
  providerCounts: Record<string, number>
  items: PreviewItem[]
}

type SummaryItem = {
  index: number
  provider: Provider
  detected_provider: Provider
  email: string
  filename: string
  path: string
  warnings?: string[]
}

type ConvertSummary = {
  output_dir: string
  provider_counts: Record<string, number>
  written_count: number
  items: SummaryItem[]
  warnings?: string[]
  errors?: string[]
  cli_proxy_import?: {
    ok: boolean
    uploaded?: number
    url?: string
    error?: string
  }
}

type ConfigResponse = {
  defaultOutputDir: string
  defaultCliProxyUrl: string
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `请求失败：${response.status}`)
  }
  return data as T
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
  const [outputDir, setOutputDir] = useState("")
  const [tzOffset, setTzOffset] = useState("+08:00")
  const [provider, setProvider] = useState("auto")
  const [writeSummary, setWriteSummary] = useState("true")
  const [cliProxyUrl, setCliProxyUrl] = useState("http://127.0.0.1:8317")
  const [managementKey, setManagementKey] = useState("")
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [summary, setSummary] = useState<ConvertSummary | null>(null)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState<"convert" | "import" | "">("")

  const canConvert = Boolean(content) && !busy
  const counts = useMemo(
    () => ({
      all: preview?.count || 0,
      codex: preview?.providerCounts?.codex || 0,
      claude: preview?.providerCounts?.claude || 0,
    }),
    [preview]
  )

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((config: ConfigResponse) => {
        setOutputDir(config.defaultOutputDir || "")
        setCliProxyUrl(config.defaultCliProxyUrl || "http://127.0.0.1:8317")
      })
      .catch((error) => setMessage(`读取默认配置失败：${error.message}`))
  }, [])

  async function previewContent(nextFilename: string, nextContent: string) {
    setMessage("")
    setSummary(null)
    const data = await postJson<PreviewResponse>("/api/preview", {
      filename: nextFilename,
      content: nextContent,
    })
    setPreview(data)
  }

  async function handleFile(file?: File) {
    if (!file) return
    const text = await file.text()
    setFilename(file.name)
    setContent(text)
    await previewContent(file.name, text)
  }

  async function convert(importAfter = false) {
    if (!content) return
    if (importAfter && !managementKey.trim()) {
      setMessage("导入到 CLIProxyAPI 需要填写 Management Key。它是管理面板登录密钥，不是普通 API Key。")
      return
    }
    setBusy(importAfter ? "import" : "convert")
    setMessage("")
    try {
      const data = await postJson<{ ok: boolean; summary: ConvertSummary }>("/api/convert", {
        filename,
        content,
        outputDir,
        provider,
        tzOffset: tzOffset || "+08:00",
        writeSummary: writeSummary === "true",
        importToCliProxyAPI: importAfter,
        cliProxyUrl: cliProxyUrl || "http://127.0.0.1:8317",
        managementKey,
      })
      setSummary(data.summary)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy("")
    }
  }

  async function openFolder() {
    try {
      await postJson("/api/open-folder", { path: outputDir })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main className="min-h-screen">
      <section className="mx-auto min-w-0 max-w-[1440px] px-5 py-5 max-md:px-3">
        <header className="mb-4 flex items-start justify-between gap-4 max-lg:flex-col">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Sub2 → CLIProxyAPI</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="h-10 rounded-xl" onClick={openFolder} variant="outline">
              <FolderOpen className="size-4" /> 打开输出目录
            </Button>
            <Button className="h-10 rounded-xl" onClick={() => window.location.reload()} variant="outline">
              <RefreshCw className="size-4" /> 刷新默认路径
            </Button>
          </div>
        </header>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
          <div className="grid gap-4">
            <Card className="shadow-xl shadow-slate-900/5">
              <CardHeader>
                <CardTitle className="text-xl font-bold">1. 选择导出文件</CardTitle>
                <CardDescription>选择 Sub2API 的 account export JSON。界面只展示邮箱、类型和警告，不展示 token。</CardDescription>
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
                    <div className="mt-2 text-sm text-slate-500">也可以直接拖到这里。文件内容只发给本机 127.0.0.1 后端转换。</div>
                  </div>
                </label>
              </CardContent>
            </Card>

            <Card className="shadow-xl shadow-slate-900/5">
              <CardHeader>
                <CardTitle className="text-xl font-bold">2. 转换设置</CardTitle>
                <CardDescription>推荐保持自动识别；如果只处理 Claude 文件，可强制选择 Claude。</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_192px]">
                  <label className="grid gap-2">
                    <FieldLabel>输出目录</FieldLabel>
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
                    <FieldLabel>CLIProxyAPI 地址</FieldLabel>
                    <Input className="h-10 rounded-xl" onChange={(event) => setCliProxyUrl(event.currentTarget.value)} value={cliProxyUrl} />
                  </label>
                  <label className="grid gap-2">
                    <FieldLabel>Management Key</FieldLabel>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        className="h-10 rounded-xl pl-9"
                        onChange={(event) => setManagementKey(event.currentTarget.value)}
                        placeholder="导入按钮需要填写"
                        type="password"
                        value={managementKey}
                      />
                    </div>
                  </label>
                </div>

                <p className="text-sm leading-6 text-slate-500">
                  “导入到 CLIProxyAPI”会调用 <b className="text-slate-800">/v0/management/auth-files</b> 上传生成的 JSON；这里要填管理面板登录用的 Management Key。
                </p>

                {message ? <StatusCallout tone="error">{message}</StatusCallout> : null}

                <div className="grid gap-2 sm:grid-cols-[minmax(160px,280px)_minmax(240px,1fr)_auto]">
                  <Button className="h-12 rounded-xl text-base" disabled={!canConvert} onClick={() => void convert(false)}>
                    {busy === "convert" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    开始转换
                  </Button>
                  <Button className="h-12 rounded-xl text-base" disabled={!canConvert} onClick={() => void convert(true)} variant="outline">
                    {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    转换并导入到 CLIProxyAPI
                  </Button>
                  <Button className="h-12 rounded-xl" onClick={openFolder} variant="outline">打开目录</Button>
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
                <CardDescription>{summary ? `已生成 ${summary.written_count} 个文件` : "转换后会显示文件名、警告和导入状态。"}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {!summary ? <EmptyResult /> : null}

                {summary?.cli_proxy_import ? (
                  <StatusCallout tone={summary.cli_proxy_import.ok ? "success" : "error"}>
                    {summary.cli_proxy_import.ok
                      ? `已导入到 CLIProxyAPI：${summary.cli_proxy_import.uploaded || 0} 个文件 · ${summary.cli_proxy_import.url || ""}`
                      : `导入 CLIProxyAPI 失败：${summary.cli_proxy_import.error || "未知错误"}`}
                  </StatusCallout>
                ) : null}

                {summary?.warnings?.length ? (
                  <StatusCallout>共有 {summary.warnings.length} 条警告；Claude 缺少 user:profile 时，额度页失败但推理可用。</StatusCallout>
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
