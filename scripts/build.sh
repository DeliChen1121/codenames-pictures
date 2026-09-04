#!/bin/sh
set -eu

mkdir -p dist/images/cards
cp index.html master.html play.html styles.css app.js game-core.js dist/

if find public/images/cards -type f \( -name '*.jpg' -o -name '*.jpeg' -o -name '*.png' -o -name '*.webp' \) -print -quit | grep -q .; then
  cp public/images/cards/*.jpg dist/images/cards/
fi

printf 'Built static site in dist/\n'
