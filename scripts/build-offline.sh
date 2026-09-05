#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
offline_root="$project_dir/offline-dist"
output_dir="$offline_root/codenames-pictures-offline"
archive_path="$offline_root/codenames-pictures-offline.zip"
content_dir="$output_dir/其他游戏文件（无需打开）"

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

cp "$project_dir/OFFLINE-LAUNCHER.html" "$output_dir/双击这里开始游戏.html"
cp "$project_dir/styles.css" "$content_dir/styles.css"
cp "$project_dir/OFFLINE-README.txt" "$content_dir/使用说明.txt"

sed 's/^export //' "$project_dir/game-core.js" > "$content_dir/offline-app.js"
printf '\n' >> "$content_dir/offline-app.js"
awk 'BEGIN { skipping = 1 } skipping && /} from "\.\/game-core\.js";/ { skipping = 0; next } !skipping { print }' \
  "$project_dir/app.js" >> "$content_dir/offline-app.js"

cp "$project_dir"/public/images/cards/*.jpg "$content_dir/images/cards/"

(
  cd "$offline_root"
  zip -q -r "$archive_path" codenames-pictures-offline
)

printf 'Built offline package: %s\n' "$archive_path"
