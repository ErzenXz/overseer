#!/bin/sh
# Print the CHANGELOG.md section for one release (e.g. v0.4.0), without its
# heading, for the GitHub release body. Fails if the section is missing or
# still marked Unreleased, so a tag can't ship without real notes.
set -eu
tag="${1:?usage: release-notes.sh vX.Y.Z}"
file="${2:-CHANGELOG.md}"
notes="$(awk -v tag="$tag" '
  /^## / { if (found) exit; if ($2 == tag) { found = 1; if ($0 ~ /Unreleased/) unreleased = 1; next } }
  found { print }
  END {
    if (!found) { print "no CHANGELOG.md section for " tag > "/dev/stderr"; exit 1 }
    if (unreleased) { print tag " is still marked Unreleased in CHANGELOG.md" > "/dev/stderr"; exit 1 }
  }
' "$file")"
# Drop the blank lines between the heading and the first paragraph.
printf '%s\n' "$notes" | sed -e '/./,$!d'
