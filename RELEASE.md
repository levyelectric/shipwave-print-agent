# ShipWave Print Agent Release Checklist

## Build modes
- Local verification (unsigned):
  - `npm run dist:dir:unsigned`
  - `npm run dist:unsigned`
- Distribution build (signed):
  - `npm run dist:dir`
  - `npm run dist`

## 1) Production signing prerequisites
- Install a **Developer ID Application** certificate in Keychain.
- Configure notarization credentials in environment variables:
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`

## 2) Build
```bash
npm install
npm run dist
```

Artifacts are generated under `dist/` (or custom output path if passed via `-c.directories.output=...`).

## 3) Verify signature and Gatekeeper acceptance
```bash
codesign -dv --verbose=4 "dist/mac-arm64/ShipWave Print Agent.app"
spctl -a -vv "dist/mac-arm64/ShipWave Print Agent.app"
```

Expected for production release:
- `Authority` should be **Developer ID Application** (not Apple Development)
- `spctl` should report `accepted`

## 4) Smoke test before distribution
- Launch app from the installed DMG.
- Enter ShipWave URL and agent token.
- Confirm status shows connected.
- Queue two labels and verify each prints exactly once.
- Kill app mid-print and verify stale-job recovery on restart.
- Confirm token persists across restart and no plaintext token appears in store file.

## 5) Rollout
- Publish DMG.
- Keep previous DMG available for rollback.
