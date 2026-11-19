# Windmill workspace

The scripts and flows here sync with Windmill through `wmill sync`. It does not merge: `pull` overwrites local files, `push` overwrites Windmill and deletes whatever `includes` in `wmill.yaml` matches there but is missing here.

Work in this order:

1. `wmill sync pull`, before editing. It overwrites uncommitted local changes, so commit or stash them first.
2. Commit, so there is a state to go back to.
3. Edit.
4. `wmill sync push` without `--yes`, and read the list of changes before answering. Stop if it deletes anything you did not delete, or names a remote other than this instance.
5. Commit and push to git.

Never run `wmill init`, and never run wmill from the repository root: its `wmill.yaml` matches nothing on purpose, so that a push run there deletes nothing.
