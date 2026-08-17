#!/usr/bin/env python3
"""Log OCI host usage and alert on pressure before the paper engines are affected."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from datetime import datetime, timezone

try:
    from scripts.telegram_notify import send_telegram_message
except ModuleNotFoundError:
    from telegram_notify import send_telegram_message


MIB = 1024 * 1024


def main() -> int:
    status = collect_status()
    print(json.dumps(status, separators=(",", ":"), sort_keys=True))
    alerts = build_alerts(status)
    if alerts:
        send_telegram_message(
            "🟠 OCI paper-engine resource pressure\n" + "\n".join(f"• {item}" for item in alerts),
            event_key="oci-resource-pressure",
            cooldown_seconds=1800,
        )
    return 0


def collect_status() -> dict[str, float | int | str | None]:
    memory = parse_meminfo(open("/proc/meminfo", encoding="utf-8").read())
    disk = shutil.disk_usage("/var/lib/multibagger")
    return {
        "asOf": datetime.now(timezone.utc).isoformat(),
        "load1": round(os.getloadavg()[0], 3),
        "memoryAvailableBytes": memory.get("MemAvailable", 0),
        "memoryTotalBytes": memory.get("MemTotal", 0),
        "swapFreeBytes": memory.get("SwapFree", 0),
        "swapTotalBytes": memory.get("SwapTotal", 0),
        "diskUsedPercent": round(disk.used / disk.total * 100, 2),
        "diskFreeBytes": disk.free,
        "paperMemoryBytes": systemd_integer("multibagger-paper.service", "MemoryCurrent"),
        "paperRestarts": systemd_integer("multibagger-paper.service", "NRestarts"),
    }


def parse_meminfo(content: str) -> dict[str, int]:
    values: dict[str, int] = {}
    for line in content.splitlines():
        key, separator, raw = line.partition(":")
        if not separator:
            continue
        parts = raw.strip().split()
        if parts and parts[0].isdigit():
            values[key] = int(parts[0]) * 1024
    return values


def systemd_integer(unit: str, property_name: str) -> int | None:
    result = subprocess.run(
        ["systemctl", "show", unit, f"--property={property_name}", "--value"],
        capture_output=True, text=True, timeout=5, check=False,
    )
    value = result.stdout.strip()
    return int(value) if result.returncode == 0 and value.isdigit() else None


def build_alerts(status: dict[str, float | int | str | None]) -> list[str]:
    alerts: list[str] = []
    available = int(status.get("memoryAvailableBytes") or 0)
    total = int(status.get("memoryTotalBytes") or 0)
    minimum_available = int(os.getenv("RESOURCE_MIN_AVAILABLE_MEMORY_MB", "150")) * MIB
    if total and available < minimum_available:
        alerts.append(f"available memory is {available / MIB:.0f} MiB")

    paper_memory = status.get("paperMemoryBytes")
    maximum_paper = int(os.getenv("RESOURCE_MAX_PAPER_MEMORY_MB", "650")) * MIB
    if isinstance(paper_memory, int) and paper_memory > maximum_paper:
        alerts.append(f"Upstox worker memory is {paper_memory / MIB:.0f} MiB")

    disk_percent = float(status.get("diskUsedPercent") or 0)
    maximum_disk = float(os.getenv("RESOURCE_MAX_DISK_PERCENT", "80"))
    if disk_percent > maximum_disk:
        alerts.append(f"disk usage is {disk_percent:.1f}%")

    swap_total = int(status.get("swapTotalBytes") or 0)
    swap_free = int(status.get("swapFreeBytes") or 0)
    if swap_total and (swap_total - swap_free) / swap_total > 0.8:
        alerts.append(f"swap usage is {(swap_total - swap_free) / swap_total * 100:.1f}%")
    return alerts


if __name__ == "__main__":
    raise SystemExit(main())
