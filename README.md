# Sub2 → CLIProxyAPI

这是一个把 Sub2API 导出的账号 JSON 转成 CLIProxyAPI/CPA 可导入 JSON 的工具。

## 目录说明

- `convert_sub2api_to_cpa.py`：本地 Python 转换脚本
- `sub2_cpa_panel.py`：本地面板服务
- `panel-ui/`：前端源码
- `docs/`：已构建好的静态站点，用于 GitHub Pages

## 本地开发

```powershell
cd panel-ui
pnpm install
pnpm build
```

## GitHub Pages

当前仓库直接发布 `docs/` 目录即可。

站点特性：

- 转换逻辑完全在浏览器本地执行
- 不依赖本地 Python 后端
- 结果通过 ZIP 下载
- 不支持从公网页面直接访问本机 `127.0.0.1` 的 CLIProxyAPI
