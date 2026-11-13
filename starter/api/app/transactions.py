from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
import errno
import importlib
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import threading
import time
from typing import Any, Iterator
from uuid import UUID, uuid4


PROJECT_LOCK_TIMEOUT_SECONDS = 30.0
LOCK_RETRY_SECONDS = 0.05


def _fcntl_module() -> Any:
    try:
        return importlib.import_module("fcntl")
    except ImportError as error:
        raise ProjectLockError(
            "Cross-process project locking is unavailable on this platform."
        ) from error


class ProjectLockError(RuntimeError):
    pass


class ProjectLockTimeout(ProjectLockError):
    pass


@dataclass
class ProjectFileLock:
    project_id: UUID
    lock_path: Path
    descriptor: int
    token: str
    owner_pid: int
    owner_thread: int
    device: int
    inode: int
    released: bool = False

    def assert_owned(self, project_id: UUID | None = None) -> None:
        if self.released or self.descriptor < 0:
            raise ProjectLockError("Project lock is not held.")
        if project_id is not None and project_id != self.project_id:
            raise ProjectLockError("Project lock belongs to a different project.")
        if self.owner_pid != os.getpid() or self.owner_thread != threading.get_ident():
            raise ProjectLockError("Project lock is being used by a different execution context.")
        try:
            descriptor_info = os.fstat(self.descriptor)
            path_info = os.stat(self.lock_path, follow_symlinks=False)
            os.lseek(self.descriptor, 0, os.SEEK_SET)
            marker = json.loads(os.read(self.descriptor, 4096))
        except (OSError, json.JSONDecodeError, TypeError) as error:
            raise ProjectLockError("Could not verify project lock ownership.") from error
        if (
            not stat.S_ISREG(descriptor_info.st_mode)
            or not stat.S_ISREG(path_info.st_mode)
            or (descriptor_info.st_dev, descriptor_info.st_ino) != (self.device, self.inode)
            or (path_info.st_dev, path_info.st_ino) != (self.device, self.inode)
            or not isinstance(marker, dict)
            or marker.get("token") != self.token
            or marker.get("pid") != self.owner_pid
        ):
            raise ProjectLockError("Project lock ownership could not be verified.")

    def release(self) -> None:
        if self.released:
            return
        try:
            self.assert_owned()
            fcntl_module = _fcntl_module()
            fcntl_module.flock(self.descriptor, fcntl_module.LOCK_UN)
        finally:
            os.close(self.descriptor)
            self.released = True
            self.descriptor = -1


_ACTIVE_PROJECT_LOCK: ContextVar[ProjectFileLock | None] = ContextVar(
    "c3canvas_active_project_lock",
    default=None,
)


def acquire_project_lock(
    data_directory: Path,
    project_id: UUID,
    timeout: float = PROJECT_LOCK_TIMEOUT_SECONDS,
) -> ProjectFileLock:
    if os.name != "posix":
        raise ProjectLockError("Cross-process project locking is unavailable on this platform.")
    fcntl_module = _fcntl_module()
    lock_directory = data_directory.resolve() / ".project-locks"
    lock_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if lock_directory.is_symlink():
        raise ProjectLockError("Project lock directory cannot be a symbolic link.")
    os.chmod(lock_directory, 0o700)
    lock_path = lock_directory / f"{project_id}.lock"
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(lock_path, flags, 0o600)
    except OSError as error:
        raise ProjectLockError("Could not open project lock file.") from error
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise ProjectLockError("Project lock path is not a regular file.")
        os.fchmod(descriptor, 0o600)
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl_module.flock(
                    descriptor, fcntl_module.LOCK_EX | fcntl_module.LOCK_NB
                )
                break
            except OSError as error:
                if error.errno not in (errno.EACCES, errno.EAGAIN):
                    raise ProjectLockError("Could not acquire project lock.") from error
                if time.monotonic() >= deadline:
                    raise ProjectLockTimeout("Project is busy; retry after its current operation finishes.")
                time.sleep(LOCK_RETRY_SECONDS)
        token = str(uuid4())
        marker = json.dumps(
            {"token": token, "pid": os.getpid(), "thread": threading.get_ident()},
            separators=(",", ":"),
        ).encode("utf-8")
        os.ftruncate(descriptor, 0)
        os.lseek(descriptor, 0, os.SEEK_SET)
        os.write(descriptor, marker)
        os.fsync(descriptor)
        lock = ProjectFileLock(
            project_id=project_id,
            lock_path=lock_path,
            descriptor=descriptor,
            token=token,
            owner_pid=os.getpid(),
            owner_thread=threading.get_ident(),
            device=info.st_dev,
            inode=info.st_ino,
        )
        lock.assert_owned(project_id)
        return lock
    except Exception:
        os.close(descriptor)
        raise


@contextmanager
def hold_project_lock(
    data_directory: Path,
    project_id: UUID,
    timeout: float = PROJECT_LOCK_TIMEOUT_SECONDS,
) -> Iterator[ProjectFileLock]:
    lock = acquire_project_lock(data_directory, project_id, timeout)
    context_token: Token[ProjectFileLock | None] = _ACTIVE_PROJECT_LOCK.set(lock)
    try:
        yield lock
    finally:
        _ACTIVE_PROJECT_LOCK.reset(context_token)
        lock.release()


def require_project_lock(project_id: UUID) -> ProjectFileLock:
    lock = _ACTIVE_PROJECT_LOCK.get()
    if lock is None:
        raise ProjectLockError("A project lock is required for this transaction operation.")
    lock.assert_owned(project_id)
    return lock


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fsync_file(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def process_identity(pid: int) -> dict[str, int | str]:
    try:
        stat_contents = Path(f"/proc/{pid}/stat").read_text(encoding="ascii")
        stat_tail = stat_contents[stat_contents.rfind(")") + 1 :].split()
        start_ticks = stat_tail[19]
        process_group = int(stat_tail[2])
        boot_id = Path("/proc/sys/kernel/random/boot_id").read_text(encoding="ascii").strip()
    except (OSError, IndexError, ValueError) as error:
        raise ProjectLockError("Could not verify Blender worker process identity.") from error
    return {
        "pid": pid,
        "start_ticks": start_ticks,
        "boot_id": boot_id,
        "process_group": process_group,
        "state": stat_tail[0],
    }


def terminate_matching_process_group(
    *,
    pid: int,
    start_ticks: str,
    boot_id: str,
    process_group: int,
    timeout: float = 10.0,
) -> bool:
    try:
        current = process_identity(pid)
    except ProjectLockError:
        return True
    if (
        current["start_ticks"] != start_ticks
        or current["boot_id"] != boot_id
        or current["process_group"] != process_group
        or current["state"] == "Z"
    ):
        return True
    try:
        os.killpg(process_group, signal.SIGTERM)
    except ProcessLookupError:
        return True
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            current = process_identity(pid)
        except ProjectLockError:
            return True
        if current["start_ticks"] != start_ticks or current["boot_id"] != boot_id or current["state"] == "Z":
            return True
        time.sleep(0.05)
    try:
        current = process_identity(pid)
    except ProjectLockError:
        return True
    if current["start_ticks"] != start_ticks or current["boot_id"] != boot_id or current["state"] == "Z":
        return True
    try:
        os.killpg(process_group, signal.SIGKILL)
    except ProcessLookupError:
        return True
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            current = process_identity(pid)
        except ProjectLockError:
            return True
        if current["start_ticks"] != start_ticks or current["boot_id"] != boot_id or current["state"] == "Z":
            return True
        time.sleep(0.05)
    return False


def ensure_regular_contained_path(root: Path, relative_path: str) -> Path:
    root = root.resolve(strict=True)
    candidate = root / relative_path
    if candidate.is_symlink():
        raise ProjectLockError("Transaction artifact paths cannot be symbolic links.")
    resolved = candidate.resolve(strict=True)
    if root not in resolved.parents or not resolved.is_file():
        raise ProjectLockError("Transaction artifact escaped its approved directory.")
    return resolved
