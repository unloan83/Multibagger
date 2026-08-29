"""
engine/forensic_agent/resource.py
===================================
OCI Resource telemetry for the Forensic Agent.

Measures: FORENSIC_CPU, PEAK_RAM_MB, DURATION_SEC, DB_QUERY_COUNT, API_CALL_COUNT,
          RESOURCE_LIMIT_BREACH (YES / NO / UNVERIFIED)

Limits (OCI micro, conservative):
  CPU < 50% average | RAM < 150 MB | Duration < 120 s | DB queries <= 100 | API calls <= 10
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any

try:
    import psutil as _psutil
    _HAS_PSUTIL = True
except ImportError:
    _psutil = None  # type: ignore[assignment]
    _HAS_PSUTIL = False

_CPU_LIMIT = 50.0
_RAM_LIMIT_MB = 150.0
_DUR_LIMIT_SEC = 120.0
_DB_LIMIT = 100
_API_LIMIT = 10


def _get_linux_proc_rss_mb() -> float:
    """Read VmRSS from /proc/self/status on Linux systems."""
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    parts = line.split()
                    return float(parts[1]) / 1024.0
    except Exception:
        pass
    return 0.0


def _get_process_cpu_seconds() -> float:
    """Read user + sys CPU time in seconds for current process."""
    try:
        t = os.times()
        return float(t.user + t.system)
    except Exception:
        return 0.0


@dataclass
class ResourceProof:
    forensic_cpu_pct: float
    peak_ram_mb: float
    duration_sec: float
    db_query_count: int
    api_call_count: int
    resource_limit_breach: str  # "YES", "NO", "UNVERIFIED"
    breach_reasons: list[str] = field(default_factory=list)
    telemetry_verified: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "FORENSIC_CPU": round(self.forensic_cpu_pct, 2),
            "PEAK_RAM_MB": round(self.peak_ram_mb, 2),
            "DURATION_SEC": round(self.duration_sec, 2),
            "DB_QUERY_COUNT": self.db_query_count,
            "API_CALL_COUNT": self.api_call_count,
            "RESOURCE_LIMIT_BREACH": self.resource_limit_breach,
            "BREACH_REASONS": self.breach_reasons,
            "TELEMETRY_VERIFIED": self.telemetry_verified,
        }

    def summary_line(self) -> str:
        return (
            f"CPU={self.forensic_cpu_pct:.1f}% RAM={self.peak_ram_mb:.1f}MB "
            f"DUR={self.duration_sec:.1f}s DB_Q={self.db_query_count} "
            f"API={self.api_call_count} BREACH={self.resource_limit_breach}"
        )


class ResourceTracker:
    def __init__(self) -> None:
        self._start_monotonic: float = 0.0
        self._start_cpu_sec: float = 0.0
        self._psutil_proc: Any = None
        self._peak_ram_mb: float = 0.0
        self._cpu_samples: list[float] = []
        self.db_query_count: int = 0
        self.api_call_count: int = 0
        self.telemetry_ok: bool = False

    def __enter__(self) -> "ResourceTracker":
        self._start_monotonic = time.monotonic()
        self._start_cpu_sec = _get_process_cpu_seconds()
        
        if _HAS_PSUTIL:
            try:
                self._psutil_proc = _psutil.Process(os.getpid())
                self._psutil_proc.cpu_percent(interval=None)  # prime
                mem = self._psutil_proc.memory_info().rss / (1024 * 1024)
                if mem > 0:
                    self._peak_ram_mb = mem
                    self.telemetry_ok = True
            except Exception:
                pass

        if not self.telemetry_ok:
            proc_rss = _get_linux_proc_rss_mb()
            if proc_rss > 0:
                self._peak_ram_mb = proc_rss
                self.telemetry_ok = True

        return self

    def __exit__(self, *_: Any) -> None:
        self._take_sample()

    def _take_sample(self) -> None:
        ram = 0.0
        if _HAS_PSUTIL and self._psutil_proc:
            try:
                s = self._psutil_proc.cpu_percent(interval=None)
                if s >= 0:
                    self._cpu_samples.append(s)
                ram = self._psutil_proc.memory_info().rss / (1024 * 1024)
            except Exception:
                pass

        if ram <= 0.0:
            ram = _get_linux_proc_rss_mb()

        if ram > self._peak_ram_mb:
            self._peak_ram_mb = ram
            self.telemetry_ok = True

    def sample(self) -> None:
        """Call mid-run to capture CPU and RAM samples."""
        self._take_sample()

    def count_db_query(self, n: int = 1) -> None:
        self.db_query_count += n

    def count_api_call(self, n: int = 1) -> None:
        self.api_call_count += n

    def proof(self) -> ResourceProof:
        self._take_sample()
        duration = max(time.monotonic() - self._start_monotonic, 0.001)

        # Compute process CPU percentage over the run duration
        cpu_time_delta = _get_process_cpu_seconds() - self._start_cpu_sec
        cpu_pct_os = max(0.0, (cpu_time_delta / duration) * 100.0)

        if self._cpu_samples:
            avg_cpu = sum(self._cpu_samples) / len(self._cpu_samples)
        else:
            avg_cpu = cpu_pct_os

        peak = self._peak_ram_mb
        if peak <= 0.0:
            peak = _get_linux_proc_rss_mb()

        telemetry_valid = (peak > 0.0)

        if not telemetry_valid:
            return ResourceProof(
                forensic_cpu_pct=0.0,
                peak_ram_mb=0.0,
                duration_sec=round(duration, 2),
                db_query_count=self.db_query_count,
                api_call_count=self.api_call_count,
                resource_limit_breach="UNVERIFIED",
                breach_reasons=["Process RAM telemetry failed or returned 0.0 MB"],
                telemetry_verified=False,
            )

        breaches: list[str] = []
        if avg_cpu > _CPU_LIMIT:
            breaches.append(f"CPU {avg_cpu:.1f}% > {_CPU_LIMIT}%")
        if peak > _RAM_LIMIT_MB:
            breaches.append(f"RAM {peak:.1f}MB > {_RAM_LIMIT_MB}MB")
        if duration > _DUR_LIMIT_SEC:
            breaches.append(f"Duration {duration:.1f}s > {_DUR_LIMIT_SEC}s")
        if self.db_query_count > _DB_LIMIT:
            breaches.append(f"DB queries {self.db_query_count} > {_DB_LIMIT}")
        if self.api_call_count > _API_LIMIT:
            breaches.append(f"API calls {self.api_call_count} > {_API_LIMIT}")

        return ResourceProof(
            forensic_cpu_pct=round(avg_cpu, 2),
            peak_ram_mb=round(peak, 2),
            duration_sec=round(duration, 2),
            db_query_count=self.db_query_count,
            api_call_count=self.api_call_count,
            resource_limit_breach="YES" if breaches else "NO",
            breach_reasons=breaches,
            telemetry_verified=True,
        )
