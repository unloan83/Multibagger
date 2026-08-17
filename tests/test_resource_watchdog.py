from scripts.resource_watchdog import MIB, build_alerts, parse_meminfo


def test_meminfo_values_are_converted_from_kibibytes_to_bytes():
    values = parse_meminfo("MemTotal: 1024 kB\nMemAvailable: 256 kB\n")
    assert values == {"MemTotal": 1024 * 1024, "MemAvailable": 256 * 1024}


def test_resource_alerts_cover_memory_worker_disk_and_swap(monkeypatch):
    monkeypatch.setenv("RESOURCE_MIN_AVAILABLE_MEMORY_MB", "150")
    monkeypatch.setenv("RESOURCE_MAX_PAPER_MEMORY_MB", "650")
    monkeypatch.setenv("RESOURCE_MAX_DISK_PERCENT", "80")
    alerts = build_alerts({
        "memoryAvailableBytes": 100 * MIB,
        "memoryTotalBytes": 956 * MIB,
        "paperMemoryBytes": 700 * MIB,
        "diskUsedPercent": 85,
        "swapTotalBytes": 1000 * MIB,
        "swapFreeBytes": 100 * MIB,
    })
    assert len(alerts) == 4


def test_healthy_resource_snapshot_has_no_alerts(monkeypatch):
    monkeypatch.delenv("RESOURCE_MIN_AVAILABLE_MEMORY_MB", raising=False)
    monkeypatch.delenv("RESOURCE_MAX_PAPER_MEMORY_MB", raising=False)
    monkeypatch.delenv("RESOURCE_MAX_DISK_PERCENT", raising=False)
    assert build_alerts({
        "memoryAvailableBytes": 370 * MIB,
        "memoryTotalBytes": 956 * MIB,
        "paperMemoryBytes": 250 * MIB,
        "diskUsedPercent": 13,
        "swapTotalBytes": 1000 * MIB,
        "swapFreeBytes": 800 * MIB,
    }) == []
