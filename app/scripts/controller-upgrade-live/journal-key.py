"""Windows user-scoped DPAPI. Raw key bytes only cross anonymous process pipes."""

import ctypes
import os
import sys
from ctypes import wintypes


class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def main():
    if os.name != "nt" or sys.argv[1:] not in (["--protect"], ["--unprotect"]):
        raise RuntimeError("WINDOWS_EXPLICIT_DPAPI_OPERATION_REQUIRED")
    payload = sys.stdin.buffer.read(4097)
    if not payload or len(payload) > 4096:
        raise RuntimeError("BOUNDED_KEY_INPUT_REQUIRED")
    if sys.argv[1] == "--protect" and len(payload) != 32:
        raise RuntimeError("MASTER_KEY_LENGTH_INVALID")
    buffer = (ctypes.c_ubyte * len(payload)).from_buffer_copy(payload)
    incoming = Blob(len(payload), buffer)
    outgoing = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    method = (
        crypt.CryptProtectData
        if sys.argv[1] == "--protect"
        else crypt.CryptUnprotectData
    )
    method.argtypes = [
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(Blob),
    ]
    method.restype = wintypes.BOOL
    try:
        if not method(
            ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)
        ):
            raise RuntimeError("DPAPI_OPERATION_FAILED")
        result = ctypes.string_at(outgoing.data, outgoing.size)
        if sys.argv[1] == "--unprotect" and len(result) != 32:
            raise RuntimeError("MASTER_KEY_LENGTH_INVALID")
        sys.stdout.buffer.write(result)
    finally:
        ctypes.memset(buffer, 0, len(payload))
        if outgoing.data:
            ctypes.memset(outgoing.data, 0, outgoing.size)
            kernel.LocalFree(outgoing.data)


if __name__ == "__main__":
    main()
