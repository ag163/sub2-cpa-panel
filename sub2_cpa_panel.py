#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sub2API -> CLIProxyAPI/CPA 本地可视化管理面板。"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib.parse import unquote, urlparse
from urllib import request as urlrequest

from convert_sub2api_to_cpa import (
    ConversionError,
    account_display_name,
    convert_export,
    extract_accounts,
    infer_provider,
)


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "cpa-import"
DEFAULT_CLI_PROXY_URL = "http://127.0.0.1:8317"
PANEL_DIST_DIR = SCRIPT_DIR / "panel-dist"
USE_PANEL_DIST = os.environ.get("SUB2_CPA_USE_PANEL_DIST") == "1"


INDEX_HTML = r'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sub2 → CLIProxyAPI 管理面板</title>
  <style>
    :root {
      --bg: oklch(0.985 0.007 255.508);
      --panel: oklch(0.998 0.002 247.858);
      --panel-muted: oklch(0.970 0.009 247.896);
      --text: oklch(0.208 0.040 265.755);
      --muted: oklch(0.554 0.046 257.417);
      --line: oklch(0.929 0.013 255.508);
      --input: oklch(0.929 0.013 255.508);
      --primary: oklch(0.546 0.215 262.881);
      --primary-strong: oklch(0.488 0.243 264.376);
      --primary-soft: oklch(0.970 0.014 254.604);
      --success: oklch(0.627 0.194 149.214);
      --success-soft: oklch(0.962 0.044 156.743);
      --warning: oklch(0.646 0.222 41.116);
      --warning-soft: oklch(0.982 0.026 95.277);
      --danger: oklch(0.577 0.245 27.325);
      --danger-soft: oklch(0.971 0.013 17.38);
      --radius: 0.625rem;
      --radius-lg: var(--radius);
      --radius-xl: calc(var(--radius) * 1.4);
      --radius-2xl: calc(var(--radius) * 1.8);
      --shadow: 0 18px 42px oklch(0.208 0.040 265.755 / 0.07);
      --shadow-sm: 0 1px 2px oklch(0.208 0.040 265.755 / 0.06);
      font-family: Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at 10% 0%, oklch(0.935 0.048 255.585 / 0.72), transparent 26rem),
        linear-gradient(180deg, oklch(0.995 0.002 247.858), var(--bg) 34rem);
    }

    b { color: var(--text); }

    .app-shell {
      min-height: 100vh;
      display: block;
    }

    .content {
      min-width: 0;
      padding: 18px 18px 28px;
      max-width: 1440px;
      margin: 0 auto;
    }

    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 12px;
    }

    .title-block h1 {
      margin: 0;
      font-size: clamp(24px, 3vw, 34px);
      letter-spacing: -0.04em;
      line-height: 1.08;
      font-weight: 850;
    }

    .top-actions, .actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    button, .button {
      min-height: 36px;
      border: 1px solid transparent;
      border-radius: 12px;
      padding: 0 14px;
      font: inherit;
      font-size: 14px;
      font-weight: 760;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      white-space: nowrap;
      transition: background .16s ease, border-color .16s ease, transform .08s ease, opacity .16s ease, box-shadow .16s ease;
      outline: none;
    }

    button:hover { transform: translateY(-1px); }
    button:active { transform: translateY(0); }
    button:disabled { cursor: not-allowed; opacity: .52; transform: none; }
    button:focus-visible { box-shadow: 0 0 0 3px oklch(0.623 0.188 259.815 / 0.18); }

    .primary {
      color: white;
      background: var(--primary);
      border-color: var(--primary);
      box-shadow: 0 12px 22px oklch(0.546 0.215 262.881 / 0.22);
    }

    .primary:hover { background: var(--primary-strong); }
    .ghost { color: oklch(0.420 0.120 262.881); background: var(--primary-soft); border-color: oklch(0.882 0.059 254.128); }
    .ghost:hover { background: oklch(0.945 0.030 255.585); }
    .muted-btn { color: var(--text); background: var(--panel); border-color: var(--line); }
    .muted-btn:hover { background: var(--panel-muted); }

    .warning-icon {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      display: inline-grid;
      place-items: center;
      flex: none;
      font-size: 13px;
      font-weight: 900;
    }

    .warning-icon { color: oklch(0.470 0.157 37.304); background: var(--warning-soft); box-shadow: inset 0 0 0 1px oklch(0.852 0.199 91.936); }

    .workspace {
      display: grid;
      grid-template-columns: minmax(0, 1.06fr) minmax(380px, .94fr);
      gap: 14px;
      margin-top: 14px;
      align-items: start;
    }

    .stack { display: grid; gap: 14px; }

    .card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--panel);
      box-shadow: var(--shadow);
      padding: 18px;
    }

    .card h2 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: -0.02em;
      font-weight: 820;
    }

    .card p {
      margin: 7px 0 0;
      color: var(--muted);
      line-height: 1.58;
      font-size: 14px;
    }

    .form { display: grid; gap: 13px; margin-top: 16px; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) 192px; gap: 12px; }
    .row.equal { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .field { display: grid; gap: 7px; }
    .field span { color: var(--text); font-size: 13px; font-weight: 780; }

    input[type="text"], input[type="password"], select {
      width: 100%;
      min-width: 0;
      height: 40px;
      border: 1px solid var(--input);
      border-radius: 12px;
      background: var(--panel);
      color: var(--text);
      padding: 0 12px;
      font: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color .16s ease, box-shadow .16s ease, background .16s ease;
    }

    input[type="text"]:focus, input[type="password"]:focus, select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px oklch(0.623 0.188 259.815 / 0.18);
    }

    .drop {
      position: relative;
      min-height: 116px;
      margin-top: 16px;
      border: 1.5px dashed oklch(0.713 0.143 254.624);
      border-radius: 16px;
      background: linear-gradient(180deg, oklch(0.985 0.010 255.508), oklch(0.998 0.002 247.858));
      display: grid;
      place-items: center;
      text-align: center;
      padding: 20px;
      cursor: pointer;
      transition: border-color .16s ease, box-shadow .16s ease;
    }

    .drop:hover { border-color: var(--primary); box-shadow: 0 0 0 3px oklch(0.623 0.188 259.815 / 0.10); }
    .drop input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .drop-ico { margin: 0 auto 8px; width: 28px; height: 28px; display: grid; place-items: center; color: var(--primary); }
    .drop-title { font-size: 16px; font-weight: 850; }
    .drop-hint { margin-top: 8px; color: var(--muted); font-size: 13px; line-height: 1.5; }

    .callout {
      margin-top: 14px;
      border: 1px solid oklch(0.852 0.199 91.936);
      background: var(--warning-soft);
      color: oklch(0.470 0.157 37.304);
      border-radius: 12px;
      padding: 10px 12px;
      display: flex;
      gap: 9px;
      align-items: flex-start;
      font-size: 14px;
      line-height: 1.5;
    }

    .callout.bad { border-color: oklch(0.885 0.062 18.334); background: var(--danger-soft); color: var(--danger); }
    .callout.ok { border-color: oklch(0.871 0.150 154.449); background: var(--success-soft); color: oklch(0.448 0.119 151.328); }

    .muted { color: var(--muted); font-size: 13px; line-height: 1.55; }

    .settings-actions {
      display: grid;
      grid-template-columns: minmax(160px, 280px) minmax(240px, 1fr) auto;
      gap: 10px;
      align-items: center;
      margin-top: 4px;
    }

    .primary.big, .ghost.big { min-height: 48px; font-size: 16px; border-radius: 12px; }

    .stat-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 16px;
    }

    .stat {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(180deg, var(--panel), oklch(0.985 0.003 247.858));
      padding: 14px;
      display: grid;
      grid-template-columns: 42px 1fr;
      align-items: center;
      gap: 12px;
    }

    .stat-icon {
      width: 42px;
      height: 42px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      color: var(--primary);
      background: var(--primary-soft);
      box-shadow: inset 0 0 0 1px oklch(0.882 0.059 254.128);
      font-weight: 850;
    }

    .stat-icon.ai { color: oklch(0.696 0.171 49.343); background: oklch(0.954 0.038 75.164); box-shadow: inset 0 0 0 1px oklch(0.879 0.100 72.000); }
    .stat b { display: block; font-size: 24px; line-height: 1; letter-spacing: -0.03em; }
    .stat span { color: var(--muted); font-size: 13px; font-weight: 700; }

    .list { display: grid; gap: 10px; margin-top: 14px; }

    .item {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--panel);
      padding: 12px;
      display: grid;
      gap: 8px;
      box-shadow: var(--shadow-sm);
    }

    .item-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .file-name { font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }

    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 850;
      line-height: 1;
      background: var(--panel-muted);
      color: var(--muted);
      box-shadow: inset 0 0 0 1px var(--line);
    }

    .pill.codex { background: var(--primary-soft); color: oklch(0.424 0.199 265.638); box-shadow: inset 0 0 0 1px oklch(0.882 0.059 254.128); }
    .pill.claude { background: oklch(0.954 0.038 75.164); color: oklch(0.421 0.095 57.708); box-shadow: inset 0 0 0 1px oklch(0.879 0.100 72.000); }
    .pill.ok { background: var(--success-soft); color: oklch(0.448 0.119 151.328); box-shadow: inset 0 0 0 1px oklch(0.871 0.150 154.449); }
    .pill.bad { background: var(--danger-soft); color: var(--danger); box-shadow: inset 0 0 0 1px oklch(0.885 0.062 18.334); }

    .empty {
      min-height: 136px;
      border: 1px dashed var(--line);
      border-radius: 14px;
      background: oklch(0.985 0.003 247.858);
      color: var(--muted);
      display: grid;
      place-items: center;
      text-align: center;
      padding: 18px;
      font-size: 14px;
    }

    .empty-rich {
      min-height: 226px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(180deg, var(--panel), oklch(0.985 0.003 247.858));
      display: grid;
      place-items: center;
      text-align: center;
      color: var(--muted);
      padding: 22px;
    }

    .empty-rich .box {
      width: 58px;
      height: 58px;
      margin: 0 auto 12px;
      border-radius: 18px;
      display: grid;
      place-items: center;
      color: oklch(0.448 0.119 151.328);
      background: var(--success-soft);
      box-shadow: inset 0 0 0 1px oklch(0.871 0.150 154.449);
      font-size: 27px;
    }

    .empty-rich strong { display: block; color: var(--text); font-size: 17px; margin-bottom: 6px; }

    @media (max-width: 980px) {
      .content { padding: 14px; }
      .topbar { flex-direction: column; }
      .top-actions { justify-content: flex-start; }
      .workspace { grid-template-columns: 1fr; }
      .row, .row.equal, .settings-actions, .stat-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="app-shell">
    <section class="content">
      <header class="topbar">
        <div class="title-block">
          <h1>Sub2 → CLIProxyAPI</h1>
        </div>
        <div class="top-actions">
          <button class="muted-btn" id="openOutTop" type="button">▣ 打开输出目录</button>
          <button class="muted-btn" id="reloadConfig" type="button">↻ 刷新默认路径</button>
        </div>
      </header>

      <section class="workspace">
        <div class="stack">
          <section class="card">
            <h2>1. 选择导出文件</h2>
            <p>选择 Sub2API 的 account export JSON。界面只展示邮箱、类型和警告，不展示 token。</p>
            <label class="drop" id="dropZone">
              <input id="fileInput" type="file" accept="application/json,.json" />
              <div>
                <div class="drop-ico">▣</div>
                <div class="drop-title" id="dropTitle">点击选择 sub2api-account-*.json</div>
                <div class="drop-hint">也可以直接拖到这里。文件内容只发给本机 127.0.0.1 后端转换。</div>
              </div>
            </label>
          </section>

          <section class="card">
            <h2>2. 转换设置</h2>
            <p>推荐保持自动识别；如果只处理 Claude 文件，可强制选择 Claude。</p>
            <div class="form">
              <div class="row">
                <label class="field">
                  <span>输出目录</span>
                  <input id="outputDir" type="text" />
                </label>
                <label class="field">
                  <span>时区</span>
                  <input id="tzOffset" type="text" value="+08:00" />
                </label>
              </div>
              <div class="row equal">
                <label class="field">
                  <span>转换类型</span>
                  <select id="provider">
                    <option value="auto">自动识别（推荐）</option>
                    <option value="codex">强制 Codex/OpenAI</option>
                    <option value="claude">强制 Claude/Anthropic</option>
                  </select>
                </label>
                <label class="field">
                  <span>摘要</span>
                  <select id="writeSummary">
                    <option value="true">生成 summary</option>
                    <option value="false">不生成</option>
                  </select>
                </label>
              </div>
              <div class="row equal">
                <label class="field">
                  <span>CLIProxyAPI 地址</span>
                  <input id="cliProxyUrl" type="text" value="http://127.0.0.1:8317" />
                </label>
                <label class="field">
                  <span>Management Key</span>
                  <input id="managementKey" type="password" placeholder="导入按钮需要填写" autocomplete="off" />
                </label>
              </div>
              <p class="muted">“导入到 CLIProxyAPI”会调用 <b>/v0/management/auth-files</b> 上传生成的 JSON；这里要填管理面板登录用的 Management Key。</p>
              <div class="settings-actions">
                <button class="primary big" id="convertBtn" type="button" disabled>▶ 开始转换</button>
                <button class="ghost big" id="convertImportBtn" type="button" disabled>⇧ 转换并导入到 CLIProxyAPI</button>
                <button class="muted-btn" id="openOutputBtn" type="button">打开目录</button>
              </div>
            </div>
          </section>
        </div>

        <aside class="stack">
          <section class="card">
            <h2>预览</h2>
            <p id="previewHint">先选择一个导出文件。</p>
            <div class="stat-grid">
              <div class="stat"><span class="stat-icon">♙</span><div><b id="countAll">0</b><span>账号数</span></div></div>
              <div class="stat"><span class="stat-icon">▣</span><div><b id="countCodex">0</b><span>Codex</span></div></div>
              <div class="stat"><span class="stat-icon ai">AI</span><div><b id="countClaude">0</b><span>Claude</span></div></div>
            </div>
            <div id="previewList" class="list"><div class="empty">暂无预览数据<br />请选择 Sub2API 导出的 JSON 文件以查看预览</div></div>
          </section>

          <section class="card">
            <h2>结果</h2>
            <p id="resultHint">转换后会显示文件名、警告和导入状态。</p>
            <div id="resultBox" class="list">
              <div class="empty-rich">
                <div>
                  <div class="box">□</div>
                  <strong>暂无结果</strong>
                  <span>请先选择文件并开始转换</span>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </section>

    </section>
  </main>

  <script>
    const els = {
      fileInput: document.getElementById('fileInput'),
      dropZone: document.getElementById('dropZone'),
      dropTitle: document.getElementById('dropTitle'),
      outputDir: document.getElementById('outputDir'),
      tzOffset: document.getElementById('tzOffset'),
      provider: document.getElementById('provider'),
      writeSummary: document.getElementById('writeSummary'),
      cliProxyUrl: document.getElementById('cliProxyUrl'),
      managementKey: document.getElementById('managementKey'),
      convertBtn: document.getElementById('convertBtn'),
      convertImportBtn: document.getElementById('convertImportBtn'),
      openOutputBtn: document.getElementById('openOutputBtn'),
      openOutTop: document.getElementById('openOutTop'),
      reloadConfig: document.getElementById('reloadConfig'),
      previewHint: document.getElementById('previewHint'),
      previewList: document.getElementById('previewList'),
      countAll: document.getElementById('countAll'),
      countCodex: document.getElementById('countCodex'),
      countClaude: document.getElementById('countClaude'),
      resultHint: document.getElementById('resultHint'),
      resultBox: document.getElementById('resultBox')
    };

    const state = { filename: '', content: '' };

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
    }

    async function postJson(url, payload) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败：${res.status}`);
      return data;
    }

    async function loadConfig() {
      const res = await fetch('/api/config');
      const data = await res.json();
      els.outputDir.value = data.defaultOutputDir;
      els.cliProxyUrl.value = data.defaultCliProxyUrl || 'http://127.0.0.1:8317';
    }

    async function previewContent() {
      if (!state.content) return;
      try {
        const data = await postJson('/api/preview', { filename: state.filename, content: state.content });
        renderPreview(data);
        els.convertBtn.disabled = false;
        els.convertImportBtn.disabled = false;
      } catch (err) {
        els.convertBtn.disabled = true;
        els.convertImportBtn.disabled = true;
        els.previewHint.textContent = '预览失败';
        els.previewList.innerHTML = `<div class="callout bad"><span class="warning-icon">!</span><span>${escapeHtml(err.message)}</span></div>`;
        els.countAll.textContent = '0';
        els.countCodex.textContent = '0';
        els.countClaude.textContent = '0';
      }
    }

    function renderPreview(data) {
      els.previewHint.textContent = data.filename ? `已读取：${data.filename}` : '已读取文件';
      els.countAll.textContent = data.count || 0;
      els.countCodex.textContent = data.providerCounts?.codex || 0;
      els.countClaude.textContent = data.providerCounts?.claude || 0;
      const items = data.items || [];
      if (!items.length) {
        els.previewList.innerHTML = '<div class="empty">没有找到可转换账号</div>';
        return;
      }
      els.previewList.innerHTML = items.map(item => `
        <div class="item">
          <div class="item-head">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="pill ${escapeHtml(item.provider)}">${escapeHtml(item.provider)}</span>
          </div>
          <div class="muted">#${item.index} · ${escapeHtml(item.platform || 'unknown')} · ${escapeHtml(item.type || 'unknown')}</div>
        </div>
      `).join('');
    }

    async function readSelectedFile(file) {
      if (!file) return;
      state.filename = file.name;
      state.content = await file.text();
      els.dropTitle.textContent = file.name;
      await previewContent();
    }

    async function convertNow(importAfter = false) {
      if (!state.content) return;
      if (importAfter && !els.managementKey.value.trim()) {
        els.resultHint.textContent = '缺少 Management Key';
        els.resultBox.innerHTML = '<div class="callout bad"><span class="warning-icon">!</span><span>导入到 CLIProxyAPI 需要填写 Management Key。它是管理面板登录密钥，不是普通 API Key。</span></div>';
        return;
      }
      els.convertBtn.disabled = true;
      els.convertImportBtn.disabled = true;
      const activeBtn = importAfter ? els.convertImportBtn : els.convertBtn;
      activeBtn.textContent = importAfter ? '转换并导入中...' : '转换中...';
      els.resultBox.innerHTML = '<div class="empty">正在转换，请稍等</div>';
      try {
        const data = await postJson('/api/convert', {
          filename: state.filename,
          content: state.content,
          outputDir: els.outputDir.value.trim(),
          provider: els.provider.value,
          tzOffset: els.tzOffset.value.trim() || '+08:00',
          writeSummary: els.writeSummary.value === 'true',
          importToCliProxyAPI: importAfter,
          cliProxyUrl: els.cliProxyUrl.value.trim() || 'http://127.0.0.1:8317',
          managementKey: els.managementKey.value.trim()
        });
        renderResult(data.summary);
      } catch (err) {
        els.resultHint.textContent = '转换失败';
        els.resultBox.innerHTML = `<div class="callout bad"><span class="warning-icon">!</span><span>${escapeHtml(err.message)}</span></div>`;
      } finally {
        els.convertBtn.disabled = !state.content;
        els.convertImportBtn.disabled = !state.content;
        els.convertBtn.textContent = '▶ 开始转换';
        els.convertImportBtn.textContent = '⇧ 转换并导入到 CLIProxyAPI';
      }
    }

    function renderResult(summary) {
      const errors = summary.errors || [];
      const warnings = summary.warnings || [];
      els.resultHint.textContent = errors.length ? '校验有错误' : `已生成 ${summary.written_count || 0} 个文件`;

      const itemsHtml = (summary.items || []).map(item => {
        const warningHtml = (item.warnings || []).map(w => `<div class="callout"><span class="warning-icon">!</span><span>${escapeHtml(w)}</span></div>`).join('');
        return `<div class="item">
          <div class="item-head">
            <span class="pill ${escapeHtml(item.provider)}">${escapeHtml(item.provider)}</span>
            <span class="pill ok">已生成</span>
          </div>
          <div class="file-name">${escapeHtml(item.filename)}</div>
          <div class="muted">${escapeHtml(item.path)}</div>
          ${warningHtml}
        </div>`;
      }).join('');

      const importResult = summary.cli_proxy_import;
      const importHtml = importResult
        ? (importResult.ok
          ? `<div class="callout ok"><span class="warning-icon">✓</span><span>已导入到 CLIProxyAPI：${escapeHtml(importResult.uploaded || 0)} 个文件 · ${escapeHtml(importResult.url || '')}</span></div>`
          : `<div class="callout bad"><span class="warning-icon">!</span><span>导入 CLIProxyAPI 失败：${escapeHtml(importResult.error || '未知错误')}</span></div>`)
        : '';
      const warnHtml = warnings.length
        ? `<div class="callout"><span class="warning-icon">!</span><span>共有 ${warnings.length} 条警告；Claude 缺少 user:profile 时，额度页失败但推理可用。</span></div>`
        : '';
      const errHtml = errors.length
        ? `<div class="callout bad"><span class="warning-icon">!</span><span>${errors.map(escapeHtml).join('<br>')}</span></div>`
        : '';

      els.resultBox.innerHTML = `${importHtml}${warnHtml}${errHtml}${itemsHtml || '<div class="empty">没有生成文件</div>'}`;
    }

    async function openFolder(path) {
      try {
        await postJson('/api/open-folder', { path });
      } catch (err) {
        els.resultBox.insertAdjacentHTML('afterbegin', `<div class="callout bad"><span class="warning-icon">!</span><span>${escapeHtml(err.message)}</span></div>`);
      }
    }

    els.fileInput.addEventListener('change', () => readSelectedFile(els.fileInput.files[0]));
    els.dropZone.addEventListener('dragover', ev => { ev.preventDefault(); els.dropZone.style.borderColor = 'oklch(0.546 0.215 262.881)'; });
    els.dropZone.addEventListener('dragleave', () => { els.dropZone.style.borderColor = ''; });
    els.dropZone.addEventListener('drop', ev => {
      ev.preventDefault();
      els.dropZone.style.borderColor = '';
      readSelectedFile(ev.dataTransfer.files[0]);
    });
    els.convertBtn.addEventListener('click', () => convertNow(false));
    els.convertImportBtn.addEventListener('click', () => convertNow(true));
    els.openOutputBtn.addEventListener('click', () => openFolder(els.outputDir.value.trim()));
    els.openOutTop.addEventListener('click', () => openFolder(els.outputDir.value.trim()));
    els.reloadConfig.addEventListener('click', loadConfig);

    loadConfig().catch(console.error);
  </script>
</body>
</html>'''


def parse_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        value = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ConversionError(f"请求 JSON 解析失败：{exc}") from exc
    if not isinstance(value, dict):
        raise ConversionError("请求体必须是 JSON 对象")
    return value


def parse_export_content(content: str) -> Any:
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise ConversionError(f"导出 JSON 解析失败：{exc}") from exc


def preview_export(raw: Any, filename: str) -> dict[str, Any]:
    accounts, _ = extract_accounts(raw)
    items: list[dict[str, Any]] = []
    provider_counts = {"codex": 0, "claude": 0}
    for index, account in enumerate(accounts, 1):
        provider = infer_provider(account)
        provider_counts[provider] = provider_counts.get(provider, 0) + 1
        items.append(
            {
                "index": index,
                "provider": provider,
                "name": account_display_name(account, index),
                "platform": account.get("platform"),
                "type": account.get("type"),
            }
        )
    return {"ok": True, "filename": filename, "count": len(items), "providerCounts": provider_counts, "items": items}


def normalize_cli_proxy_url(value: str) -> str:
    url = (value or DEFAULT_CLI_PROXY_URL).strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ConversionError("CLIProxyAPI 地址格式不正确，例如：http://127.0.0.1:8317")
    return url


def build_multipart_files(files: list[Path]) -> tuple[bytes, str]:
    boundary = f"----sub2cpa-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for path in files:
        if not path.is_file():
            raise ConversionError(f"生成文件不存在，无法导入：{path}")
        filename = path.name.replace('"', "_")
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                'Content-Disposition: form-data; name="file"; '
                f'filename="{filename}"\r\n'
                "Content-Type: application/json\r\n\r\n"
            ).encode("utf-8")
        )
        chunks.append(path.read_bytes())
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), boundary


def import_files_to_cli_proxy_api(files: list[Path], *, cli_proxy_url: str, management_key: str) -> dict[str, Any]:
    if not files:
        return {"ok": True, "uploaded": 0, "files": [], "url": normalize_cli_proxy_url(cli_proxy_url)}
    if not management_key.strip():
        raise ConversionError("导入到 CLIProxyAPI 需要 Management Key")

    base_url = normalize_cli_proxy_url(cli_proxy_url)
    endpoint = f"{base_url}/v0/management/auth-files"
    body, boundary = build_multipart_files(files)
    req = urlrequest.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {management_key.strip()}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
    )
    try:
        with urlrequest.urlopen(req, timeout=20) as response:
            raw_body = response.read().decode("utf-8", errors="replace")
            try:
                parsed: Any = json.loads(raw_body) if raw_body else {}
            except json.JSONDecodeError:
                parsed = {"raw": raw_body[:500]}
            return {
                "ok": True,
                "uploaded": len(files),
                "files": [path.name for path in files],
                "url": base_url,
                "response": parsed,
            }
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        if exc.code == 401:
            message = "CLIProxyAPI 返回 401：Management Key 不正确或未填写。"
        elif exc.code == 404:
            message = "CLIProxyAPI 返回 404：请确认地址是管理面板所在地址，例如 http://127.0.0.1:8317。"
        else:
            message = f"CLIProxyAPI 返回 HTTP {exc.code}。"
        raise ConversionError(f"{message} {detail}".strip()) from exc
    except urlerror.URLError as exc:
        raise ConversionError(f"连接 CLIProxyAPI 失败：{exc.reason}") from exc


class PanelHandler(BaseHTTPRequestHandler):
    server_version = "Sub2CPAPanel/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def send_text(self, status: int, body: str, content_type: str = "text/html; charset=utf-8") -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def send_json(self, status: int, data: dict[str, Any]) -> None:
        body = json.dumps(data, ensure_ascii=False)
        self.send_text(status, body, "application/json; charset=utf-8")

    def send_file(self, path: Path) -> None:
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store" if path.name == "index.html" else "public, max-age=31536000")
        self.end_headers()
        self.wfile.write(data)

    def maybe_send_panel_asset(self, request_path: str) -> bool:
        # 默认不要加载 panel-dist。线上 GitHub Pages 使用 docs/ 静态产物；
        # 本地 Python 面板必须走内置的后端版 UI，否则“转换并导入到 CLIProxyAPI”
        # 会被静态托管版的浏览器安全限制拦截，无法访问本机 127.0.0.1。
        if not USE_PANEL_DIST or not PANEL_DIST_DIR.is_dir():
            return False
        if request_path in {"/", "/index.html"}:
            index_path = PANEL_DIST_DIR / "index.html"
            if index_path.is_file():
                self.send_file(index_path)
                return True
            return False
        relative = unquote(request_path).lstrip("/")
        if not relative.startswith("assets/"):
            return False
        root = PANEL_DIST_DIR.resolve()
        target = (PANEL_DIST_DIR / relative).resolve()
        if target.is_file() and target.is_relative_to(root):
            self.send_file(target)
            return True
        return False

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if self.maybe_send_panel_asset(path):
            return
        if path in {"/", "/index.html"}:
            self.send_text(200, INDEX_HTML)
            return
        if path == "/api/config":
            self.send_json(
                200,
                {
                    "ok": True,
                    "defaultOutputDir": str(DEFAULT_OUTPUT_DIR),
                    "defaultCliProxyUrl": DEFAULT_CLI_PROXY_URL,
                    "scriptDir": str(SCRIPT_DIR),
                },
            )
            return
        self.send_json(404, {"ok": False, "error": "接口不存在"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            payload = parse_json_body(self)
            if path == "/api/preview":
                raw = parse_export_content(str(payload.get("content") or ""))
                self.send_json(200, preview_export(raw, str(payload.get("filename") or "")))
                return
            if path == "/api/convert":
                self.handle_convert(payload)
                return
            if path == "/api/open-folder":
                self.handle_open_folder(payload)
                return
            self.send_json(404, {"ok": False, "error": "接口不存在"})
        except ConversionError as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:  # 兜底，避免浏览器只看到断链。
            self.send_json(500, {"ok": False, "error": f"服务端错误：{exc}"})

    def handle_convert(self, payload: dict[str, Any]) -> None:
        content = str(payload.get("content") or "")
        if not content:
            raise ConversionError("请先选择 Sub2API 导出 JSON")
        raw = parse_export_content(content)

        output_dir = str(payload.get("outputDir") or DEFAULT_OUTPUT_DIR).strip() or str(DEFAULT_OUTPUT_DIR)
        import_to_cli_proxy_api = bool(payload.get("importToCliProxyAPI"))

        summary = convert_export(
            raw,
            output_dir=Path(output_dir),
            provider=str(payload.get("provider") or "auto"),
            tz_offset=str(payload.get("tzOffset") or "+08:00"),
            input_label=str(payload.get("filename") or "uploaded.json"),
            write_summary=bool(payload.get("writeSummary", True)),
        )
        if import_to_cli_proxy_api:
            files = [Path(item["path"]) for item in summary.get("items", []) if item.get("path")]
            try:
                summary["cli_proxy_import"] = import_files_to_cli_proxy_api(
                    files,
                    cli_proxy_url=str(payload.get("cliProxyUrl") or DEFAULT_CLI_PROXY_URL),
                    management_key=str(payload.get("managementKey") or ""),
                )
            except ConversionError as exc:
                summary["cli_proxy_import"] = {
                    "ok": False,
                    "error": str(exc),
                    "url": str(payload.get("cliProxyUrl") or DEFAULT_CLI_PROXY_URL),
                }
        self.send_json(200, {"ok": True, "summary": summary})

    def handle_open_folder(self, payload: dict[str, Any]) -> None:
        raw_path = str(payload.get("path") or "").strip()
        if not raw_path:
            raise ConversionError("路径为空")
        target = Path(raw_path).expanduser()
        target.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(target))  # type: ignore[attr-defined]
        else:
            import subprocess

            subprocess.Popen(["xdg-open", str(target)])
        self.send_json(200, {"ok": True})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start local Sub2API -> CLIProxyAPI/CPA visual panel.")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认 127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="监听端口，默认 8765")
    parser.add_argument("--no-open", action="store_true", help="启动后不自动打开浏览器")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), PanelHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"Sub2 → CLIProxyAPI 管理面板已启动：{url}")
    print("关闭窗口或按 Ctrl+C 停止。")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
