import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const root = new URL("../", import.meta.url);
const zip = fileURLToPath(new URL("offline-dist/codenames-pictures-offline.zip", root));
const output = new URL("offline-dist/codenames-pictures-offline/", root);
execFileSync("unzip", ["-t", zip], { stdio: "pipe" });
const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
assert.deepEqual([...new Set(entries.map((name) => name.split("/")[0]))].sort(), ["LAUNCH_GAME.html", "game_assets"]);
assert.ok(entries.every((name) => /^[\x20-\x7e]+$/.test(name)), "All archive paths must use English/ASCII names");
assert.ok(!entries.some((name) => name.includes("..") || name.startsWith("/")), "Archive paths must stay inside the extracted folder");
for (const name of ["index.html", "play.html", "master.html", "offline-app.js", "styles.css", "README.txt", "COPYRIGHT.txt"]) {
  assert.ok(entries.includes("game_assets/" + name), "Missing bundled file: " + name);
}
const imageEntries = entries.filter((name) => /^game_assets\/images\/cards\/card-\d+\.jpg$/.test(name));
assert.equal(imageEntries.length, 280);
for (let index = 0; index < 280; index++) {
  assert.ok(imageEntries.includes(`game_assets/images/cards/card-${index}.jpg`), "Missing card " + index);
}
for (const name of entries.filter((entry) => /\.(html|js|css|txt)$/.test(entry))) {
  const archived = execFileSync("unzip", ["-p", zip, name]);
  assert.deepEqual(archived, readFileSync(new URL(name, output)), "Archive differs from build output: " + name);
  const content = archived.toString("utf8");
  assert.ok(!/\p{Script=Han}/u.test(content), "Non-English content in " + name);
  if (!name.endsWith(".html")) continue;
  assert.match(content, /<html lang="en">/);
  assert.ok(!/type="module"/.test(content), "Offline HTML must not depend on module loading");
  for (const match of content.matchAll(/(?:src|href)="(\.[^"#?]+)(?:[?#][^"]*)?"/g)) {
    const target = new URL(match[1], new URL(name, output));
    assert.ok(existsSync(target), `Broken local link in ${name}: ${match[1]}`);
  }
}
const launcher = readFileSync(new URL("LAUNCH_GAME.html", output), "utf8");
assert.match(launcher, /\.\/game_assets\/index\.html/);
assert.deepEqual(readFileSync(new URL("game_assets/COPYRIGHT.txt", output)), readFileSync(new URL("COPYRIGHT.txt", root)));
const script = readFileSync(new URL("game_assets/offline-app.js", output), "utf8");
new Script(script);
assert.ok(!script.includes("samdemaeyer.github.io"), "The offline app must not fetch upstream images");
console.log("Offline ZIP verified: two root entries, 280 pictures, English pages, valid local links, executable bundle, and copyright notice.");
