"""Never fill the host disk: long jobs call wait_for_space() before each batch and pause while the
drive holding Docker's disk image is nearly full (MariaDB's writes grow that image)."""
import os, shutil, time

MIN_FREE_GB = float(os.environ.get("MIN_FREE_GB", 3))
DRIVE = os.environ.get("GUARD_DRIVE", os.path.splitdrive(os.environ.get("LOCALAPPDATA", "C:\\"))[0] + "\\")


def free_gb():
    return shutil.disk_usage(DRIVE).free / 1e9


def wait_for_space(label=""):
    warned = False
    while free_gb() < MIN_FREE_GB:
        if not warned:
            print(f"[disk guard] only {free_gb():.1f} GB free on {DRIVE} — pausing {label} "
                  f"until {MIN_FREE_GB} GB is free", flush=True)
            warned = True
        time.sleep(30)
    if warned:
        print(f"[disk guard] {free_gb():.1f} GB free — resuming {label}", flush=True)
