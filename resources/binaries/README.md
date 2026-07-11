# Bundled third-party binaries

These prebuilt executables are shipped with FlockFlasher (via electron-builder
`extraResources` / `asarUnpack`) and are invoked during the flashing/ISO-rebuild
flow. They run with elevated privileges, so their provenance and integrity matter.

`SHA256SUMS` records the SHA-256 of each file. Verify before/after updating with:

```sh
cd resources/binaries && shasum -a 256 -c SHA256SUMS
```

## Inventory, upstream and license

| File | Purpose | Upstream | License |
|------|---------|----------|---------|
| `darwin/xorriso`, `win32/xorriso.exe` | Rebuild the bootable ISO | GNU xorriso (https://www.gnu.org/software/xorriso/) | GPLv3 |
| `win32/cygwin1.dll`, `win32/cygiconv-2.dll` | Cygwin runtime for the Windows xorriso build | Cygwin (https://cygwin.com/) | LGPLv3 |
| `win32/dd.exe` | Raw device write on Windows | (to confirm) | (to confirm) |
| `win32/du.exe`, `win32/du64.exe`, `win32/du64a.exe` | Folder-size progress on Windows | Sysinternals `du` (https://learn.microsoft.com/sysinternals/downloads/du) | Sysinternals EULA |

TODO (provenance hardening):
- Pin and record the exact upstream version for each binary.
- Confirm and fill in the `dd.exe` source + license (GPL builds require offering
  corresponding source — check for a license conflict with this MIT project).
- Add an `arm64` xorriso slice for Apple Silicon so ISO rebuild does not rely on
  the x64 binary under Rosetta.
- Re-generate `SHA256SUMS` whenever a binary is updated.
