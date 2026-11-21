## Development Workflow

**IMPORTANT**: After any code change, bug fix, or feature addition/removal, you MUST complete all of these steps:

1. **Bump version consistently** across all release manifests following semantic versioning (`MAJOR.MINOR.PATCH`):
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
   - Every new version pushed to `master` automatically triggers the GitHub Actions release workflow (`.github/workflows/release.yml`), which builds the signed Windows NSIS `setup.exe` installer and `latest.json` updater manifest and publishes them to GitHub Releases.

2. **Update README.md** if the change affects:
   - Usage examples or commands
   - Installation instructions
   - Configuration options
   - Available features

3. **Update CHANGELOG.md**:
   - Add new version number following semantic versioning (MAJOR.MINOR.PATCH)
   - Add entry under appropriate category (Added, Changed, Fixed, Removed)
   - Include date in format YYYY-MM-DD

4. **Commit and push changes**:
   - Use `git add` to stage all modified files (`README.md`, `CHANGELOG.md`, version manifests, and code files)
   - Create descriptive commit message following existing style
   - Push to remote repository with `git push`

5. **Clean Tauri build artifacts after pushing**:
   - Run `npm run tauri:clean` (or `cargo clean --manifest-path src-tauri/Cargo.toml`) after pushing to keep the workspace clean and reclaim disk space.
