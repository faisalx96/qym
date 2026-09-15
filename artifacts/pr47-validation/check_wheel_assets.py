"""Compare packaged, served assets and migrations with the current checkout."""

import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[2]
output = root / "artifacts/pr47-validation"
report = {}
for wheel in sorted((output / "wheels").glob("*.whl")):
    package = "qym_platform" if wheel.name.startswith("qym_platform-") else "qym"
    source = root / "packages" / ("platform" if package == "qym_platform" else "sdk") / package
    with ZipFile(wheel) as archive:
        names = set(archive.namelist())
        assets = [p for area in ("dashboard", "ui") for p in (source / "_static" / area).rglob("*") if p.is_file() and "__pycache__" not in p.parts]
        assets = sorted(set(assets) | {p for p in source.rglob("*.py") if "__pycache__" not in p.parts})
        missing = [str(p.relative_to(source.parent)) for p in assets if str(p.relative_to(source.parent)) not in names]
        changed = [str(p.relative_to(source.parent)) for p in assets if str(p.relative_to(source.parent)) in names and archive.read(str(p.relative_to(source.parent))) != p.read_bytes()]
        report[wheel.name] = {
            "bytes": wheel.stat().st_size,
            "sha256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
            "checked_python_served_assets_and_migrations": len(assets),
            "missing": missing,
            "source_mismatches": changed,
        }
        assert not missing and not changed, report[wheel.name]
report["scope"] = "Every package Python source file, all assets in the mounted dashboard/ui directories, and all platform migrations. The unused, unmounted _static/app bundle is outside the existing wheel package-data and was not changed."
(output / "wheel-assets.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
