"""Regression checks for the publication boundary, without a publication token."""
from pathlib import Path
import yaml

flow = yaml.safe_load(Path(".github/workflows/release.yml").read_text())
dispatch = flow[True]["workflow_dispatch"]
inputs = dispatch["inputs"]
assert inputs["mode"]["default"] == "Build only" and inputs["confirm"]["default"] is False
jobs = flow["jobs"]
guard = jobs["publish"]["if"]
assert guard == "inputs.mode == 'Publish' && inputs.confirm && github.event_name == 'workflow_dispatch'"
assert jobs["publish"]["needs"] == "verify"
assert jobs["verify"]["needs"] == "build"
assert jobs["build"]["environment"] == "ploom-release"
assert jobs["build"]["strategy"]["matrix"]["version"] == jobs["verify"]["strategy"]["matrix"]["version"]
assert "(inputs.mode == 'Publish' && inputs.confirm)" in jobs["build"]["if"]
assert jobs["windows"]["needs"] == "verify"
assert flow["permissions"] == {"contents": "read"}
for name, job in jobs.items():
    if name == "publish":
        assert job["permissions"] == {"contents":"write"}
    else:
        assert job.get("permissions", flow["permissions"]) == {"contents":"read"}
        assert "gh release " not in str(job.get("steps", []))
assert "|| 'verified-release'" in jobs["verify"]["steps"][-1]["with"]["name"]
print("Build only and Build hotfix pair are read-only. Publish requires confirmation.")
