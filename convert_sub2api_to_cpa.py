#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 Sub2API 导出的账号 JSON 转成 CLIProxyAPI/CPA 可导入的单账号 JSON 文件。

支持：
  - Codex/OpenAI OAuth -> codex-*.json
  - Claude/Anthropic setup-token/OAuth -> claude-*.json

默认用法：
  python convert_sub2api_to_cpa.py

指定 Claude：
  python convert_sub2api_to_cpa.py sub2api-account.json --provider claude -o cpa-import

说明：生成摘要不会包含 token 明文。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


CODEX_KEYS = [
    "access_token",
    "account_id",
    "disabled",
    "email",
    "expired",
    "id_token",
    "last_refresh",
    "refresh_token",
    "type",
]

CLAUDE_REQUIRED_KEYS = [
    "type",
    "access_token",
    "refresh_token",
    "email",
    "expired",
    "last_refresh",
]

CLAUDE_METADATA_KEYS = [
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
]

PROVIDER_CHOICES = ["auto", "codex", "claude"]
INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class ConversionError(ValueError):
    """用户输入或导出结构导致的转换错误。"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert Sub2API account export JSON to CLIProxyAPI/CPA import JSON files.",
    )
    parser.add_argument(
        "input",
        nargs="?",
        default=None,
        help="Sub2API 导出的 JSON 文件；不填时自动查找当前目录/脚本目录中的导出 JSON",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="cpa-import",
        help="输出目录，默认：cpa-import",
    )
    parser.add_argument(
        "--provider",
        choices=PROVIDER_CHOICES,
        default="auto",
        help="转换类型：auto 自动识别，或强制 codex / claude；默认：auto",
    )
    parser.add_argument(
        "--tz-offset",
        default="+08:00",
        help="expired / last_refresh 输出时区，默认：+08:00",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="额外生成 conversion-summary.json 摘要文件；摘要不含 token 明文。",
    )
    parser.add_argument(
        "--fail-on-warning",
        action="store_true",
        help="存在警告时返回非 0 退出码。",
    )
    return parser.parse_args()


def clean_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def first_non_empty(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def get_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConversionError(f"找不到输入文件：{path}") from exc
    except json.JSONDecodeError as exc:
        raise ConversionError(f"JSON 解析失败：{path}，{exc}") from exc


def parse_timezone(offset: str) -> timezone:
    match = re.fullmatch(r"([+-])(\d{2}):?(\d{2})", offset.strip())
    if not match:
        raise ConversionError("时区格式错误，请使用类似 +08:00 或 -0500")
    sign, hours, minutes = match.groups()
    delta = timedelta(hours=int(hours), minutes=int(minutes))
    if sign == "-":
        delta = -delta
    return timezone(delta)


def base64url_decode_json(part: str) -> dict[str, Any]:
    padded = part + "=" * ((4 - len(part) % 4) % 4)
    return json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))


def jwt_payload(token: str | None) -> dict[str, Any]:
    if not token or token.count(".") < 2:
        return {}
    try:
        return base64url_decode_json(token.split(".")[1])
    except Exception:
        return {}


def parse_exported_at(value: str | None) -> int | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        return int(datetime.fromisoformat(normalized).timestamp())
    except ValueError:
        return None


def timestamp_to_iso(value: int | float | str, tz: timezone) -> str:
    number = float(value)
    # 兼容毫秒时间戳。
    if abs(number) > 10_000_000_000:
        number = number / 1000
    return datetime.fromtimestamp(number, tz).replace(microsecond=0).isoformat()


def iso_from_ts(ts: int | float | str | None, tz: timezone) -> str:
    if ts in (None, ""):
        return ""
    if isinstance(ts, str):
        value = ts.strip()
        if not value:
            return ""
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=tz)
            return parsed.astimezone(tz).replace(microsecond=0).isoformat()
        except ValueError:
            pass
    try:
        return timestamp_to_iso(ts, tz)
    except (TypeError, ValueError, OSError, OverflowError) as exc:
        raise ConversionError(f"时间格式无法识别：{ts!r}") from exc


def safe_filename(value: str) -> str:
    cleaned = INVALID_FILENAME_CHARS.sub("_", value).strip().strip(".")
    return cleaned or "unknown"


def extract_accounts(raw: Any) -> tuple[list[dict[str, Any]], int | None]:
    if isinstance(raw, dict):
        exported_at_ts = parse_exported_at(clean_str(raw.get("exported_at")))
        accounts = raw.get("accounts")
        if isinstance(accounts, list):
            return [a for a in accounts if isinstance(a, dict)], exported_at_ts

        # 兼容已经是单账号 CLIProxyAPI/CPA 结构的误输入；不会转换，只给出明确错误。
        if all(key in raw for key in CODEX_KEYS) or all(key in raw for key in CLAUDE_REQUIRED_KEYS):
            raise ConversionError("输入看起来已经是 CLIProxyAPI/CPA 单账号 JSON，不是 Sub2API 导出。")

    if isinstance(raw, list):
        return [a for a in raw if isinstance(a, dict)], None

    raise ConversionError("不支持的输入结构：需要包含 accounts 数组的 Sub2API JSON。")


def looks_like_sub2api_export(path: Path) -> bool:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return False

    if isinstance(raw, dict):
        accounts = raw.get("accounts")
        return isinstance(accounts, list)
    if isinstance(raw, list):
        return all(isinstance(item, dict) for item in raw)
    return False


def find_default_input(script_dir: Path) -> Path:
    search_dirs: list[Path] = []
    for directory in [Path.cwd(), script_dir]:
        if directory not in search_dirs:
            search_dirs.append(directory)

    preferred_names = [
        "sub2api-account-all.json",
        "sub2api-.json",
    ]

    for directory in search_dirs:
        for name in preferred_names:
            candidate = directory / name
            if candidate.is_file() and looks_like_sub2api_export(candidate):
                return candidate

    candidates: list[Path] = []
    for directory in search_dirs:
        for candidate in directory.glob("*.json"):
            if candidate.name == "conversion-summary.json":
                continue
            if looks_like_sub2api_export(candidate):
                candidates.append(candidate)

    unique_candidates = list(dict.fromkeys(candidates))
    if len(unique_candidates) == 1:
        return unique_candidates[0]
    if not unique_candidates:
        raise ConversionError(
            "找不到 Sub2API 导出 JSON：请把导出文件放在脚本同目录，"
            "或用命令行指定输入文件。"
        )

    names = "\n".join(f"  - {path}" for path in unique_candidates)
    raise ConversionError(f"找到多个可能的输入文件，请明确指定其中一个：\n{names}")


def resolve_input_path(input_arg: str | None, script_dir: Path) -> Path:
    if not input_arg:
        return find_default_input(script_dir)

    input_path = Path(input_arg)
    if input_path.is_absolute() or input_path.exists():
        return input_path

    script_relative = script_dir / input_path
    if script_relative.exists():
        return script_relative

    return input_path


def resolve_output_dir(output_dir_arg: str, *, input_arg: str | None, input_path: Path, script_dir: Path) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir

    # 双击/默认输入时，把输出写到脚本所在目录，避免受 Windows 启动目录影响。
    if not input_arg:
        return script_dir / output_dir

    # 明确指定输入但输入文件在脚本目录时，也优先把输出放在同目录。
    try:
        input_parent = input_path.resolve().parent if input_path.exists() else input_path.parent
        if not Path(input_arg).is_absolute() and input_parent == script_dir:
            return script_dir / output_dir
    except OSError:
        pass

    return output_dir


def infer_provider(account: dict[str, Any]) -> str:
    credentials = get_dict(account.get("credentials"))
    platform = clean_str(account.get("platform")).lower()
    account_type = clean_str(account.get("type")).lower()
    access_token = clean_str(credentials.get("access_token"))
    refresh_token = clean_str(credentials.get("refresh_token"))
    scope = clean_str(credentials.get("scope")).lower()

    if (
        platform in {"anthropic", "claude"}
        or "anthropic" in platform
        or "claude" in platform
        or access_token.startswith("sk-ant-")
        or refresh_token.startswith("sk-ant-")
        or any(key in credentials for key in ["account_uuid", "org_uuid", "email_address"])
        or "anthropic" in scope
    ):
        return "claude"

    if (
        platform in {"openai", "chatgpt", "codex"}
        or account_type in {"oauth", "openai", "codex"}
        or access_token.count(".") >= 2
        or any(key in credentials for key in ["chatgpt_account_id", "chatgpt_user_id", "organization_id"])
    ):
        return "codex"

    # Sub2API 旧导出大多是 Codex，所以未知时保守按 Codex 处理，并给校验警告。
    return "codex"


def account_display_name(account: dict[str, Any], index: int) -> str:
    credentials = get_dict(account.get("credentials"))
    extra = get_dict(account.get("extra"))
    return clean_str(
        first_non_empty(
            credentials.get("email"),
            credentials.get("email_address"),
            extra.get("email"),
            extra.get("email_address"),
            account.get("name"),
            f"account-{index}",
        )
    )


def account_to_codex(
    account: dict[str, Any],
    *,
    index: int,
    exported_at_ts: int | None,
    tz: timezone,
) -> tuple[dict[str, Any], str, list[str], str]:
    warnings: list[str] = []
    credentials = get_dict(account.get("credentials"))
    extra = get_dict(account.get("extra"))

    access_token = clean_str(credentials.get("access_token"))
    refresh_token = clean_str(credentials.get("refresh_token"))
    id_token = clean_str(credentials.get("id_token"))

    payload = jwt_payload(access_token)
    auth = get_dict(payload.get("https://api.openai.com/auth"))
    profile = get_dict(payload.get("https://api.openai.com/profile"))

    email = clean_str(
        first_non_empty(
            extra.get("email"),
            credentials.get("email"),
            profile.get("email"),
            account.get("name"),
            f"account-{index}",
        )
    )

    account_id = clean_str(
        first_non_empty(
            credentials.get("chatgpt_account_id"),
            auth.get("chatgpt_account_id"),
        )
    )

    expires_at = first_non_empty(credentials.get("expires_at"), payload.get("exp"))
    issued_at = first_non_empty(payload.get("iat"), credentials.get("issued_at"))
    if not issued_at and expires_at and credentials.get("expires_in"):
        try:
            issued_at = int(float(expires_at)) - int(float(credentials["expires_in"]))
        except (TypeError, ValueError):
            issued_at = None
    if not issued_at:
        issued_at = exported_at_ts

    plan = clean_str(first_non_empty(auth.get("chatgpt_plan_type"), extra.get("plan"), "free"))

    if infer_provider(account) != "codex":
        warnings.append(f"{email}: 当前账号不像 Codex/OpenAI，可能是强制 provider 导致")
    if not access_token:
        warnings.append(f"{email}: 缺少 access_token")
    if not refresh_token:
        warnings.append(f"{email}: 缺少 refresh_token，已用 access_token 占位")
        refresh_token = access_token
    if not id_token:
        warnings.append(f"{email}: 缺少 id_token，已用 access_token 占位")
        id_token = access_token
    if refresh_token == access_token:
        warnings.append(f"{email}: refresh_token 与 access_token 相同，可能不能自动刷新")
    if not account_id:
        warnings.append(f"{email}: 缺少 account_id")
    if not expires_at:
        warnings.append(f"{email}: 缺少过期时间")

    cpa = {
        "access_token": access_token,
        "account_id": account_id,
        "disabled": bool(account.get("disabled", False)),
        "email": email,
        "expired": iso_from_ts(expires_at, tz),
        "id_token": id_token,
        "last_refresh": iso_from_ts(issued_at, tz),
        "refresh_token": refresh_token,
        "type": "codex",
    }

    filename = f"codex-{safe_filename(email)}-{safe_filename(plan)}.json"
    return cpa, filename, warnings, email


def account_to_claude(
    account: dict[str, Any],
    *,
    index: int,
    exported_at_ts: int | None,
    tz: timezone,
) -> tuple[dict[str, Any], str, list[str], str]:
    warnings: list[str] = []
    credentials = get_dict(account.get("credentials"))
    extra = get_dict(account.get("extra"))

    access_token = clean_str(credentials.get("access_token"))
    refresh_token = clean_str(credentials.get("refresh_token"))
    id_token = clean_str(credentials.get("id_token"))
    email = clean_str(
        first_non_empty(
            credentials.get("email_address"),
            credentials.get("email"),
            extra.get("email_address"),
            extra.get("email"),
            account.get("name"),
            f"claude-account-{index}",
        )
    )

    expires_at = first_non_empty(credentials.get("expires_at"), extra.get("expires_at"))
    issued_at = first_non_empty(
        credentials.get("issued_at"),
        extra.get("passive_usage_sampled_at"),
        account.get("updated_at"),
        exported_at_ts,
    )
    if not issued_at and expires_at and credentials.get("expires_in"):
        try:
            issued_at = int(float(expires_at)) - int(float(credentials["expires_in"]))
        except (TypeError, ValueError):
            issued_at = None

    scope = clean_str(credentials.get("scope"))
    scope_items = set(scope.replace(",", " ").split())

    if infer_provider(account) != "claude":
        warnings.append(f"{email}: 当前账号不像 Claude/Anthropic，可能是强制 provider 导致")
    if not access_token:
        warnings.append(f"{email}: 缺少 access_token")
    if not refresh_token:
        warnings.append(f"{email}: 缺少 refresh_token")
    if access_token and not access_token.startswith("sk-ant-"):
        warnings.append(f"{email}: access_token 不是常见 sk-ant-* 形式，请确认来源")
    if not expires_at:
        warnings.append(f"{email}: 缺少过期时间")
    if scope and "user:profile" not in scope_items:
        warnings.append(
            f"{email}: Claude token 缺少 user:profile，CLIProxyAPI 额度/资料页可能失败；推理通常不受影响"
        )

    claude: dict[str, Any] = {
        "type": "claude",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "email": email,
        "expired": iso_from_ts(expires_at, tz),
        "last_refresh": iso_from_ts(issued_at, tz),
        "disabled": bool(account.get("disabled", False)),
        "label": email,
        "source": "sub2api-account-export",
    }
    if id_token:
        claude["id_token"] = id_token

    if account.get("notes"):
        claude["note"] = clean_str(account.get("notes"))
    if account.get("priority") is not None:
        claude["priority"] = account.get("priority")

    metadata_sources = [credentials, extra]
    for key in CLAUDE_METADATA_KEYS:
        value = first_non_empty(*(source.get(key) for source in metadata_sources))
        if value is not None:
            claude[key] = value

    # CLIProxyAPI 的 Claude 管理页按 email 字段显示；email_address 留给源码侧可能读取 metadata 使用。
    if "email_address" not in claude and email:
        claude["email_address"] = email

    filename = f"claude-{safe_filename(email)}.json"
    return claude, filename, warnings, email


def validate_codex_object(value: dict[str, Any], filename: str) -> list[str]:
    errors: list[str] = []
    if list(value.keys()) != CODEX_KEYS:
        errors.append(f"{filename}: 字段顺序或字段集合不匹配 CPA/Codex 模板")
    for key in CODEX_KEYS:
        if key not in value:
            errors.append(f"{filename}: 缺少字段 {key}")
    for key in ["access_token", "account_id", "email", "expired", "id_token", "last_refresh", "refresh_token", "type"]:
        if not value.get(key):
            errors.append(f"{filename}: 字段 {key} 为空")
    if value.get("type") != "codex":
        errors.append(f"{filename}: type 不是 codex")
    return errors


def validate_claude_object(value: dict[str, Any], filename: str) -> list[str]:
    errors: list[str] = []
    for key in CLAUDE_REQUIRED_KEYS:
        if key not in value:
            errors.append(f"{filename}: 缺少字段 {key}")
        elif not value.get(key):
            errors.append(f"{filename}: 字段 {key} 为空")
    if value.get("type") != "claude":
        errors.append(f"{filename}: type 不是 claude")
    return errors


def validate_import_object(value: dict[str, Any], filename: str, provider: str) -> list[str]:
    if provider == "codex":
        return validate_codex_object(value, filename)
    if provider == "claude":
        return validate_claude_object(value, filename)
    return [f"{filename}: 未知 provider {provider}"]


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def convert_export(
    raw: Any,
    *,
    output_dir: Path | str,
    provider: str = "auto",
    tz_offset: str = "+08:00",
    input_label: str = "",
    source_path: Path | str | None = None,
    write_summary: bool = False,
) -> dict[str, Any]:
    if provider not in PROVIDER_CHOICES:
        raise ConversionError(f"provider 必须是 {', '.join(PROVIDER_CHOICES)}")

    tz = parse_timezone(tz_offset)
    accounts, exported_at_ts = extract_accounts(raw)
    if not accounts:
        raise ConversionError("没有找到可转换账号。")

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    written_files: list[Path] = []
    all_warnings: list[str] = []
    errors: list[str] = []
    items: list[dict[str, Any]] = []
    provider_counts: Counter[str] = Counter()

    for index, account in enumerate(accounts, 1):
        detected_provider = infer_provider(account)
        target_provider = detected_provider if provider == "auto" else provider
        provider_counts[target_provider] += 1

        try:
            if target_provider == "claude":
                value, filename, warnings, email = account_to_claude(
                    account,
                    index=index,
                    exported_at_ts=exported_at_ts,
                    tz=tz,
                )
            else:
                value, filename, warnings, email = account_to_codex(
                    account,
                    index=index,
                    exported_at_ts=exported_at_ts,
                    tz=tz,
                )
        except ConversionError as exc:
            errors.append(f"第 {index} 个账号转换失败：{exc}")
            continue

        all_warnings.extend(warnings)
        output_file = output_path / filename
        write_json(output_file, value)

        try:
            saved = load_json(output_file)
            errors.extend(validate_import_object(saved, filename, target_provider))
        except ConversionError as exc:
            errors.append(str(exc))

        written_files.append(output_file)
        items.append(
            {
                "index": index,
                "provider": target_provider,
                "detected_provider": detected_provider,
                "email": email,
                "filename": filename,
                "path": str(output_file),
                "warnings": warnings,
            }
        )

    summary = {
        "source": str(source_path or input_label or ""),
        "output_dir": str(output_path),
        "provider": provider,
        "provider_counts": dict(provider_counts),
        "written_count": len(written_files),
        "files": [p.name for p in written_files],
        "items": items,
        "warnings": all_warnings,
        "errors": errors,
    }

    if write_summary:
        (output_path / "conversion-summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    return summary


def main() -> int:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    try:
        input_path = resolve_input_path(args.input, script_dir)
        output_dir = resolve_output_dir(
            args.output_dir,
            input_arg=args.input,
            input_path=input_path,
            script_dir=script_dir,
        )
        raw = load_json(input_path)
        summary = convert_export(
            raw,
            output_dir=output_dir,
            provider=args.provider,
            tz_offset=args.tz_offset,
            input_label=input_path.name,
            source_path=input_path,
            write_summary=args.summary,
        )
    except ConversionError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(f"转换完成：{summary['written_count']} 个账号")
    print(f"输出目录：{Path(summary['output_dir']).resolve()}")
    if summary.get("provider_counts"):
        counts = ", ".join(f"{name}={count}" for name, count in summary["provider_counts"].items())
        print(f"类型统计：{counts}")
    for item in summary["items"]:
        print(f"  - [{item['provider']}] {item['filename']}")

    warnings = summary.get("warnings") or []
    errors = summary.get("errors") or []

    if warnings:
        print("\n警告：", file=sys.stderr)
        for warning in warnings:
            print(f"  - {warning}", file=sys.stderr)

    if errors:
        print("\n校验失败：", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 2

    if warnings and args.fail_on_warning:
        return 1

    print("\n校验通过：生成文件均为可解析 JSON，字段已对齐 CLIProxyAPI/CPA 导入格式。")
    return 0


def should_pause_before_exit() -> bool:
    return (
        os.name == "nt"
        and len(sys.argv) == 1
        and os.environ.get("SUB2API_CPA_NO_PAUSE") != "1"
        and sys.stdin.isatty()
        and sys.stdout.isatty()
    )


def pause_before_exit() -> None:
    if not should_pause_before_exit():
        return
    try:
        input("\n按 Enter 关闭窗口...")
    except EOFError:
        pass


def cli() -> int:
    try:
        return main()
    except SystemExit as exc:
        if isinstance(exc.code, int):
            return exc.code
        if exc.code:
            print(exc.code, file=sys.stderr)
        return 1


if __name__ == "__main__":
    exit_code = cli()
    pause_before_exit()
    raise SystemExit(exit_code)
