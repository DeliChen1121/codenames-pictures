#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
offline_root="$project_dir/offline-dist"
output_dir="$offline_root/codenames-pictures-offline"
archive_path="$offline_root/codenames-pictures-offline.zip"
content_dir="$output_dir/game_assets"

case "$output_dir" in
  "$project_dir/offline-dist/codenames-pictures-offline") ;;
  *) printf 'Unexpected offline output path.\n' >&2; exit 1 ;;
esac

rm -rf "$output_dir"
rm -f "$archive_path"
mkdir -p "$content_dir/images/cards"

for page in index.html play.html master.html; do
  sed 's#<script type="module" src="\./app\.js"></script>#<script src="./offline-app.js"></script>#' \
    "$project_dir/$page" > "$content_dir/$page"
done

cp "$project_dir/OFFLINE-LAUNCHER.html" "$output_dir/LAUNCH_GAME.html"
cp "$project_dir/styles.css" "$content_dir/styles.css"
cp "$project_dir/OFFLINE-README.txt" "$content_dir/README.txt"
cp "$project_dir/COPYRIGHT.txt" "$content_dir/COPYRIGHT.txt"

sed 's/^export //' "$project_dir/game-core.js" > "$content_dir/offline-app.js"
printf '\n' >> "$content_dir/offline-app.js"
awk 'BEGIN { skipping = 1 } skipping && /} from "\.\/game-core\.js";/ { skipping = 0; next } !skipping { print }' \
  "$project_dir/app.js" >> "$content_dir/offline-app.js"

cp "$project_dir"/public/images/cards/*.jpg "$content_dir/images/cards/"

(
  cd "$output_dir"
  zip -q -r "$archive_path" LAUNCH_GAME.html game_assets
)

printf 'Built offline package: %s\n' "$archive_path"
