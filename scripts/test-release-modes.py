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
shared = yaml.safe_load(Path(".github/workflows/signed-packages.yml").read_text())
assert set(shared["jobs"]) == {"build", "verify"}
assert shared["permissions"] == {"contents":"read"}
assert shared["jobs"]["verify"]["needs"] == "build"
assert jobs["verify"]["uses"] == "./.github/workflows/signed-packages.yml"
assert "(inputs.mode == 'Build only' || (inputs.mode == 'Publish' && inputs.confirm))" in jobs["verify"]["if"]
assert flow["permissions"] == {"contents": "read"}
for name, job in jobs.items():
    if name == "publish":
        assert job["permissions"] == {"contents":"write"}
    else:
        assert job.get("permissions", flow["permissions"]) == {"contents":"read"}
        assert "gh release " not in str(job.get("steps", []))
assert shared["jobs"]["verify"]["steps"][-1]["with"]["name"] == "${{ inputs.pair && format('verified-{0}', inputs.version) || 'verified-release' }}"
print("Build only is the read-only default. Publishing requires Publish, confirmation and verified assets.")
