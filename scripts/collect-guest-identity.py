#!/usr/bin/env python3
"""Read guest OS facts inside the slot; never read credentials or rotate identity."""
import datetime
import json
import os
from pathlib import Path
import platform
import socket


def read_optional(name):
    try:
        return Path(name).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


release = platform.freedesktop_os_release()
timezone = os.environ.get("TZ") or read_optional("/etc/timezone")
if not timezone:
    localtime = str(Path("/etc/localtime").resolve())
    timezone = localtime.split("/zoneinfo/", 1)[-1] if "/zoneinfo/" in localtime else ""

print(json.dumps({
    "schema_version": "1",
    "runtime_kind": "docker",
    "hostname": socket.gethostname(),
    "os_id": release.get("ID", "linux"),
    "os_pretty": release.get("PRETTY_NAME", "Linux"),
    "kernel_release": platform.release(),
    "arch": platform.machine(),
    "goos": "linux",
    "machine_id": read_optional("/etc/machine-id") or read_optional("/var/lib/dbus/machine-id"),
    "timezone": timezone,
    "locale": os.environ.get("LC_ALL") or os.environ.get("LC_CTYPE") or os.environ.get("LANG", ""),
    "collected_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}))
