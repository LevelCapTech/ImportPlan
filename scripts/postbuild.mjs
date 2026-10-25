// Writes the per-directory package.json markers so Node treats the two build
// outputs with the correct module system.
import { writeFileSync, existsSync } from "node:fs";

function writeMarker(dir, type) {
  if (!existsSync(dir)) {
    throw new Error(`Expected build output directory "${dir}" to exist.`);
  }
  writeFileSync(`${dir}/package.json`, `${JSON.stringify({ type }, null, 2)}\n`);
}

writeMarker("dist/esm", "module");
writeMarker("dist/cjs", "commonjs");
