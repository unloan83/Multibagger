from __future__ import annotations

import logging
try:
    import psutil
except ImportError:
    psutil = None

from dataclasses import dataclass
from typing import Literal

LOG = logging.getLogger("multibagger.resource")

TaskPriority = Literal["RISK_POSITION_MGMT", "EXECUTION", "MARKET_ANALYSIS", "SCANNING", "EOD_ANALYTICS"]


@dataclass
class ResourceState:
    cpu_percent: float
    ram_percent: float
    is_under_pressure: bool
    allowed_tasks: list[TaskPriority]


class ResourcePriorityWatchdog:
    """
    Monitors OCI Free Tier resource constraints (1GB RAM budget).
    Under pressure (RAM > 80% or CPU > 90%), degrades non-critical tasks (Scanning, EOD Analytics)
    while preserving 100% priority for Risk, Position Management, and Execution.
    """

    def __init__(self, ram_threshold_pct: float = 80.0, cpu_threshold_pct: float = 90.0):
        self.ram_threshold_pct = ram_threshold_pct
        self.cpu_threshold_pct = cpu_threshold_pct

    def check_resource_state(self) -> ResourceState:
        alerts = []
        try:
            ram = psutil.virtual_memory().percent
            cpu = psutil.cpu_percent(interval=None)
            swap_used = psutil.swap_memory().used
            if ram > 80.0:
                alerts.append(f"RAM_USAGE_HIGH_{ram:.1f}%")
        except Exception:
            ram = 50.0
            cpu = 20.0

        is_under_pressure = ram >= self.ram_threshold_pct or cpu >= self.cpu_threshold_pct

        if is_under_pressure:
            LOG.warning("OCI Resource Pressure Detected (RAM: %.1f%%, CPU: %.1f%%, Alerts: %s). Degrading non-critical tasks.",
                        ram, cpu, alerts or ["RAM_EXCEEDS_80%"])
            allowed = ["RISK_POSITION_MGMT", "EXECUTION", "MARKET_ANALYSIS"]
        else:
            allowed = ["RISK_POSITION_MGMT", "EXECUTION", "MARKET_ANALYSIS", "SCANNING", "EOD_ANALYTICS"]

        return ResourceState(
            cpu_percent=cpu,
            ram_percent=ram,
            is_under_pressure=is_under_pressure,
            allowed_tasks=allowed,
        )


    def is_task_permitted(self, task: TaskPriority) -> bool:
        state = self.check_resource_state()
        permitted = task in state.allowed_tasks
        if not permitted:
            LOG.info("Task %s DEGRADED due to OCI resource pressure.", task)
        return permitted
