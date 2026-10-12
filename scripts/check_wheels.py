"""Verify clean package boundaries and source fidelity, including repeat builds."""

import json
import sys
from pathlib import Path
from zipfile import ZipFile

results = []
for filename in sys.argv[1:]:
    wheel = Path(filename)
    platform = wheel.name.startswith("qym_platform-")
    package = "qym_platform" if platform else "qym"
    source = Path("packages") / ("platform" if platform else "sdk") / package
    expected = {str(path.relative_to(source)): path for path in source.rglob("*.py")}
    with ZipFile(wheel) as archive:
        names = set(archive.namelist())
        unexpected = [name for name in names if not name.startswith(package + "/") and ".dist-info/" not in name]
        assert not unexpected, (filename, unexpected)
        actual = {name[len(package) + 1:] for name in names if name.startswith(package + "/") and name.endswith(".py")}
        assert actual == set(expected), (filename, actual - set(expected), set(expected) - actual)
        for relative, path in expected.items():
            assert archive.read(package + "/" + relative) == path.read_bytes(), relative
        if not platform:
            viewer = {n for n in names if n.startswith("qym/_static/ui/")}
            for required in ["index.html", "app.js", "app.css"]:
                assert "qym/_static/ui/" + required in viewer, "SDK wheel lacks the built viewer (run npm run build:sdk): " + required
        if platform:
            app_files = {n for n in names if n.startswith("qym_platform/_static/app/")}
            assert "qym_platform/_static/app/index.html" in app_files, (
                "Platform wheel lacks the built React app (run `npm run build` in frontend/ before building the wheel)"
            )
            assets = [n for n in app_files if n.startswith("qym_platform/_static/app/assets/") and n.endswith(".js")]
            assert assets, "Platform wheel carries index.html but no built JS assets"
            stale = [n for n in names if n.startswith("qym_platform/_static/dashboard/")]
            assert not stale, ("The removed vanilla dashboard is back in the wheel", stale[:5])
            for template in ["run.html", "dashboard.css", "metrics.js", "qym_safe.js"]:
                relative = "export_templates/run/" + template
                assert archive.read(package + "/" + relative) == (source / relative).read_bytes(), template
        results.append({"wheel": wheel.name, "python_files": len(expected), "source_matches": True, "no_stale_or_nested_build_modules": True})
assert len(results) == 2, "Pass the SDK and platform wheels"
print(json.dumps(results, indent=2))
