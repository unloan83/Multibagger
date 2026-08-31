from __future__ import annotations

import atexit
import fcntl
import logging
import os
import sys

logger = logging.getLogger("lockfile")

class SingleInstanceLock:
    def __init__(self, lock_path: str = "data/multibagger_paper.lock"):
        self.lock_path = lock_path
        self.fd = None
        self.acquired = False

    def acquire(self) -> bool:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(self.lock_path)), exist_ok=True)
            self.fd = open(self.lock_path, "w", encoding="utf-8")
            
            # Request OS-level exclusive non-blocking advisory lock
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            
            self.fd.write(str(os.getpid()))
            self.fd.flush()
            self.acquired = True
            atexit.register(self.release)
            logger.info("Single-instance OS flock acquired (PID: %d).", os.getpid())
            return True
        except (IOError, BlockingIOError, OSError) as e:
            logger.critical("DUPLICATE_ENGINE_START: Another Multibagger engine instance holds OS flock on %s. Aborting.", self.lock_path)
            if self.fd:
                try:
                    self.fd.close()
                except Exception:
                    pass
                self.fd = None
            return False
        except Exception as e:
            logger.error("Failed to acquire OS flock lockfile: %s", e)
            return False

    def release(self):
        if self.acquired and self.fd:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_UN)
                self.fd.close()
                self.fd = None
                self.acquired = False
                if os.path.exists(self.lock_path):
                    os.remove(self.lock_path)
                logger.info("Single-instance OS flock released.")
            except Exception as e:
                logger.warning("Error releasing OS flock lockfile %s: %s", self.lock_path, e)
